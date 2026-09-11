import { createSupabaseServiceClient } from "./supabase/service.ts";
import { getOwnerEmailByUserId } from "./owner-verify.ts";
import { sendEmail } from "./email/send.ts";
import {
  DAY_MS,
  NOTIFICATION_POLICY,
  isEmailableNotification,
  type EmailableNotificationType,
  type NotificationType,
} from "./notification-policy.ts";
import {
  notificationSubject,
  renderNotificationEmailHtml,
  renderNotificationEmailText,
} from "./email/notification.ts";

/**
 * NOTIFICATION HOOK — the single function every notification point in
 * the app calls. It records an in-app row and, for most types, sends an
 * email through Resend.
 *
 * THE IN-APP ROW IS THE SOURCE OF TRUTH. Email is an addition to it and
 * never a precondition: if Resend errors, times out, or has no API key,
 * the row is still written and this function still resolves. A
 * notification that vanished because an email provider had a bad minute
 * would be a worse failure than a missing email.
 */
export type NotifyOptions = {
  vesselId?: string;
  /**
   * The episode this notification belongs to, for types whose policy
   * dedupes by key rather than by time — the transfer id, for transfer
   * events. Ignored by window-mode types.
   */
  dedupeKey?: string;
};

export async function notifyOwner(
  ownerId: string,
  type: NotificationType,
  message: string,
  options: string | NotifyOptions = {},
): Promise<void> {
  // The fourth argument used to be a bare vesselId. Accepting both keeps
  // the existing call sites working and unchanged rather than rewriting
  // them to prove a point.
  const { vesselId, dedupeKey }: NotifyOptions = typeof options === "string" ? { vesselId: options } : options;

  const service = createSupabaseServiceClient();
  if (!service) return;

  // The row goes in FIRST, before anything that could fail slowly. It is
  // the record; everything below is best effort on top of it.
  const { data: inserted, error } = await service
    .from("owner_notifications")
    .insert({ owner_id: ownerId, type, message, vessel_id: vesselId ?? null, dedupe_key: dedupeKey ?? null })
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`[notify] Failed to record notification (type=${type}, owner=${ownerId}):`, error);
  }

  if (!isEmailableNotification(type)) return;

  try {
    await maybeSendNotificationEmail({
      service,
      ownerId,
      type,
      message,
      vesselId,
      dedupeKey,
      insertedId: (inserted as { id: string } | null)?.id ?? null,
    });
  } catch (err) {
    // Belt and braces. maybeSendNotificationEmail is written not to
    // throw, but this function's contract is that it always resolves and
    // that contract should not depend on the care taken downstream.
    console.error(`[notify] Email step threw (type=${type}, owner=${ownerId}):`, err);
  }
}

async function maybeSendNotificationEmail(args: {
  service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>;
  ownerId: string;
  type: EmailableNotificationType;
  message: string;
  vesselId?: string;
  dedupeKey?: string;
  insertedId: string | null;
}): Promise<void> {
  const { service, ownerId, type, message, vesselId, dedupeKey, insertedId } = args;

  const to = await getOwnerEmailByUserId(ownerId);
  if (!to) {
    console.warn(`[notify] No email on file for owner ${ownerId}; in-app row recorded, email skipped.`);
    return;
  }

  // DEDUPLICATION, and it suppresses the EMAIL ONLY.
  //
  // The row above is already written and stays written. A duplicate
  // banner is harmless and the row is a record of a real delivery; a
  // duplicate email about one failed payment is the thing this exists to
  // prevent.
  //
  // Reads the rows that already exist rather than keeping separate
  // state: a second source of truth about what was sent is a thing that
  // can disagree with the first.
  const strategy = NOTIFICATION_POLICY[type].dedupe;

  let query = service
    .from("owner_notifications")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("type", type);

  if (strategy.mode === "key") {
    if (!dedupeKey) {
      // A key-mode type with no key cannot be deduplicated at all, and
      // sending anyway would be the exact duplicate this is here to
      // stop. Loud, because it is a programming error at the call site
      // rather than anything the owner did.
      console.error(`[notify] ${type} dedupes by key but no dedupeKey was given; skipping email. In-app row still recorded.`);
      return;
    }
    // No time bound. A transfer's events belong to that transfer whether
    // they are minutes or months apart.
    query = query.eq("dedupe_key", dedupeKey);
  } else if (strategy.mode === "window") {
    query = query.gte("created_at", new Date(Date.now() - strategy.windowMs).toISOString());
    // Null is not equal to anything in SQL, so an account-level
    // notification has to be matched with IS NULL rather than = null.
    query = vesselId ? query.eq("vessel_id", vesselId) : query.is("vessel_id", null);
  }

  // Excluding the row written moments ago, which would otherwise always
  // match and suppress every email.
  if (insertedId) query = query.neq("id", insertedId);

  const { count, error: dedupeError } = strategy.mode === "none"
    ? { count: 0, error: null }
    : await query;

  if (dedupeError) {
    // Fail closed. The whole point of this stage is that one payment
    // failure produces one email, so when we cannot tell whether we have
    // already sent, the safe answer is not to send again. The owner
    // still has the in-app row.
    console.error(`[notify] Dedupe check failed (type=${type}, owner=${ownerId}); skipping email:`, dedupeError);
    return;
  }

  if ((count ?? 0) > 0) {
    console.log(
      `[notify] Duplicate suppressed (type=${type}, owner=${ownerId}, ${
        strategy.mode === "key" ? `key=${dedupeKey}` : `vessel=${vesselId ?? "none"}, window=${(strategy as { windowMs: number }).windowMs / DAY_MS}d`
      }): ${count} prior notification(s). In-app row still recorded.`,
    );
    return;
  }

  // The MXE ID rather than "Account" in the header when the event is
  // about one boat, so an owner with several knows which before opening.
  let mxeId: string | null = null;
  if (vesselId) {
    const { data: vessel } = await service.from("vessels").select("mxe_id").eq("id", vesselId).maybeSingle();
    mxeId = (vessel as { mxe_id: string } | null)?.mxe_id ?? null;
  }

  const input = { type, message, mxeId };
  const result = await sendEmail({
    to,
    subject: notificationSubject(type),
    html: renderNotificationEmailHtml(input),
    text: renderNotificationEmailText(input),
  });

  if (result.sent) {
    console.log(`[notify] Emailed ${type} to owner ${ownerId} (resend id=${result.id ?? "unknown"}).`);
  } else if (result.reason === "disabled") {
    console.log(`[notify] Email disabled (no RESEND_API_KEY); ${type} recorded in-app only for owner ${ownerId}.`);
  } else {
    console.error(`[notify] Resend failed for ${type}, owner ${ownerId}: ${result.detail}. In-app row still recorded.`);
  }
}

// Call sites import NotificationType from here; keep that working rather
// than editing every one of them to point at the policy module.
export { NOTIFICATION_POLICY, type NotificationType, type NotificationPolicy } from "./notification-policy.ts";
