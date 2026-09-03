import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * NOTIFICATION HOOK — the single function every notification point in
 * the app calls. There's no email provider chosen yet (deferred), so
 * today this only inserts a row into owner_notifications; a banner on
 * /dashboard reads unread rows for the signed-in owner and renders them.
 *
 * When a provider is chosen, add the send call in ONE place — inside
 * this function, below — no call site needs to change. Grep
 * `notifyOwner(` to find every place a notification fires.
 */
export type NotificationType =
  | "subscription_past_due"
  | "vessel_lapsed"
  | "downgrade_grace_started"
  | "vessel_locked"
  | "vessel_reactivated";

export async function notifyOwner(
  ownerId: string,
  type: NotificationType,
  message: string,
  vesselId?: string,
): Promise<void> {
  const service = createSupabaseServiceClient();
  if (!service) return;

  const { error } = await service.from("owner_notifications").insert({
    owner_id: ownerId,
    type,
    message,
    vessel_id: vesselId ?? null,
  });
  if (error) {
    console.error(`[notify] Failed to record notification (type=${type}, owner=${ownerId}):`, error);
  }

  // TODO(email): once a provider is chosen, send a transactional email
  // here too — this is the one place that needs to change.
}
