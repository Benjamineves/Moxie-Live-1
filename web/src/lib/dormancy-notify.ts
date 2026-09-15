import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";
import { getStripe } from "./stripe/server.ts";
import { tierForPriceId } from "./stripe/tiers.ts";
import type { SubscriptionTier } from "./tier-config.ts";
import { countActiveVessels } from "./vessel-cap.ts";
import { notifyOwner } from "./notify.ts";
import {
  decideGraceNotification,
  graceStartedMessage,
  parseClearLapsedResult,
  parseOwnerDormancyResult,
  tierFromSubscriptions,
  vesselsLapsedAfterPaymentFailureMessage,
  vesselsLockedMessage,
  vesselsRecoveredMessage,
  vesselsRestoredMessage,
} from "./dormancy-notifications.ts";

/**
 * The I/O half of the dormancy notifications. Every decision is made by
 * lib/dormancy-notifications.ts, which explains the rules — including how the
 * signup-bundle race is handled. This file reads state, asks Stripe, claims,
 * and sends.
 */

type Service = SupabaseClient<PermissiveDatabase>;

/**
 * True for the error PostgREST returns when a column does not exist yet —
 * i.e. this code is deployed and 20261002 has not been run. Pushes deploy
 * immediately and migrations are run by hand afterwards, so there is always
 * a window where this is the expected state, and it must not throw: a throw
 * here would fail every webhook that reconciles until the migration runs.
 */
function isMissingColumn(error: { code?: string; message?: string }): boolean {
  return error.code === "42703" || error.code === "PGRST204" || /column .* does not exist/i.test(error.message ?? "");
}

/**
 * Sends downgrade_grace_started if, and only if, this account has a grace
 * clock running that nobody has been told about and Stripe confirms the
 * overflow is real. Safe to call after every reconcile; most calls do
 * nothing.
 *
 * THROWS on a failed read or a failed Stripe lookup. It runs inside the
 * Stripe webhook, where a throw becomes a 500 and a redelivery, and
 * everything before it is idempotent. Because the decision is made from
 * stored state rather than from "this call started the clock", the retry
 * evaluates exactly the same question and cannot lose the notification.
 */
export async function notifyDowngradeGraceIfDue(service: Service, ownerId: string): Promise<void> {
  const { data, error } = await service
    .from("users")
    .select("subscription_tier, stripe_customer_id, downgrade_grace_until, downgrade_grace_notified_for")
    .eq("id", ownerId)
    .maybeSingle();
  if (error) {
    if (isMissingColumn(error)) {
      console.warn(
        `[dormancy-notify] users.downgrade_grace_notified_for is missing — 20261002 has not been run. Grace notification for ${ownerId} skipped.`,
      );
      return;
    }
    throw new Error(`could not read grace state for owner ${ownerId}: ${error.message}`);
  }
  const row = data as {
    subscription_tier: string | null;
    stripe_customer_id: string | null;
    downgrade_grace_until: string | null;
    downgrade_grace_notified_for: string | null;
  } | null;
  if (!row?.downgrade_grace_until) return;

  // Already told about this clock: done, before counting anything or asking Stripe.
  if (
    row.downgrade_grace_notified_for &&
    new Date(row.downgrade_grace_notified_for).getTime() === new Date(row.downgrade_grace_until).getTime()
  ) {
    return;
  }

  const active = await countActiveVessels(service, ownerId);
  if ("error" in active) throw new Error(`could not count active vessels for owner ${ownerId}: ${active.error}`);

  // The tier Stripe says the account is on now. Only when Stripe has nothing
  // current (no subscription — a transfer buyer, or an account set by hand)
  // does the stored tier stand.
  let stripeTier: SubscriptionTier | null = null;
  if (row.stripe_customer_id) {
    const subs = await getStripe().subscriptions.list({ customer: row.stripe_customer_id, status: "all", limit: 20 });
    stripeTier = tierFromSubscriptions(
      subs.data.map((s) => {
        const price = s.items.data[0]?.price;
        return { id: s.id, status: s.status, created: s.created, priceId: typeof price === "string" ? price : (price?.id ?? null) };
      }),
      tierForPriceId,
    );
  }
  const tier = stripeTier ?? (row.subscription_tier === "full" ? "full" : "basic");

  const decision = decideGraceNotification({
    graceUntil: row.downgrade_grace_until,
    notifiedFor: row.downgrade_grace_notified_for,
    activeCount: active.count,
    tier,
  });
  if (!decision.notify) {
    if (decision.reason === "not_over_confirmed_tier") {
      console.log(
        `[dormancy-notify] owner ${ownerId}: grace clock running, but ${active.count} active vessel(s) fit ${tier} (${decision.limit}) as Stripe reports it — not notifying; the tier event will clear the clock.`,
      );
    }
    return;
  }

  // Claim before sending. Guarded on the clock still being this clock and
  // not yet claimed, so concurrent reconciles send one notification, and a
  // clock that was cleared or restarted in the meantime is not claimed.
  const clock = row.downgrade_grace_until;
  const { data: claimed, error: claimError } = await service
    .from("users")
    .update({ downgrade_grace_notified_for: clock })
    .eq("id", ownerId)
    .eq("downgrade_grace_until", clock)
    .or(`downgrade_grace_notified_for.is.null,downgrade_grace_notified_for.neq."${clock}"`)
    .select("id");
  if (claimError) throw new Error(`could not claim the grace notification for owner ${ownerId}: ${claimError.message}`);
  if (!claimed || claimed.length === 0) return;

  await notifyOwner(ownerId, "downgrade_grace_started", graceStartedMessage({ activeCount: active.count, tier, graceUntil: clock }));
}

/**
 * vessel_locked, once for the account. The caller passes the ids
 * apply_overflow_fallback returned, which it returns only to the call that
 * locked them — so this is safe to call from a page render, including a
 * stranger's badge scan. A NULL result (the function before 20261002)
 * arrives here as not-an-array and sends nothing.
 */
export async function notifyVesselsLocked(ownerId: string, lockedIds: unknown): Promise<void> {
  if (!Array.isArray(lockedIds) || lockedIds.length === 0) return;
  await notifyOwner(ownerId, "vessel_locked", vesselsLockedMessage(lockedIds.length));
}

/**
 * vessel_lapsed, once for the account, when the past-due grace ran out.
 *
 * The ids come from apply_past_due_dormancy_if_expired (via
 * reconcile_owner_dormancy or reconcile_all_dormancy), which returns them only
 * to the call that paused the vessels. After the window expires the account
 * stays past_due and every page load re-runs the lapse, but finds nothing
 * still active, so this sends once.
 */
export async function notifyVesselsLapsedAfterPaymentFailure(ownerId: string, lapsedIds: unknown): Promise<void> {
  if (!Array.isArray(lapsedIds) || lapsedIds.length === 0) return;
  await notifyOwner(ownerId, "vessel_lapsed", vesselsLapsedAfterPaymentFailureMessage(lapsedIds.length));
}

/**
 * Both notifications a reconcile_owner_dormancy call can produce, from its
 * result in either the 20261002 or 20261003 shape. For the page renders that
 * run the lazy dormancy checks.
 */
export async function notifyOwnerDormancyResult(ownerId: string, data: unknown): Promise<void> {
  const { lockedIds, lapsedIds } = parseOwnerDormancyResult(data);
  await notifyVesselsLapsedAfterPaymentFailure(ownerId, lapsedIds);
  await notifyVesselsLocked(ownerId, lockedIds);
}

/**
 * Lapsed vessels restored when a subscription became active — two
 * different events, so two different types.
 *
 *  - A failed payment recovered on the same subscription, usually by Stripe
 *    retrying on its own: nobody was watching, so it emails
 *    (vessel_reactivated_payment_recovered).
 *  - A new subscription after a cancellation: the owner resubscribed at
 *    checkout and is watching it happen, so in-app only (vessel_reactivated).
 *
 * clear_vessels_lapsed tells them apart in the database — see 20261003.
 */
export async function notifyVesselsRestored(ownerId: string, data: unknown): Promise<void> {
  const { restoredIds, recoveredFromPastDue } = parseClearLapsedResult(data);
  if (restoredIds.length === 0) return;
  if (recoveredFromPastDue) {
    await notifyOwner(ownerId, "vessel_reactivated_payment_recovered", vesselsRecoveredMessage(restoredIds.length));
  } else {
    await notifyOwner(ownerId, "vessel_reactivated", vesselsRestoredMessage(restoredIds.length));
  }
}
