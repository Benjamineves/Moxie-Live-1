import { TIER_LABELS, VESSEL_LIMIT, type SubscriptionTier } from "./tier-config.ts";

/**
 * WHEN A DORMANCY EVENT BECOMES A NOTIFICATION, AND WHAT IT SAYS.
 *
 * Pure: no Stripe, no database, no email. lib/dormancy-notify.ts does the
 * I/O and asks these functions every question that has an answer.
 *
 * ONCE PER ACCOUNT. A downgrade that locks four boats sends one
 * notification naming the count, not four.
 *
 * THE SIGNUP-BUNDLE RACE, AND WHY THE GRACE NOTIFICATION IS NOT FIRED WHEN
 * THE CLOCK STARTS.
 *
 * A bundled signup's payment and its plan's tier arrive on separate Stripe
 * events, in either order. When the payment lands first, activation
 * reconciles against the account's OLD tier (Basic by default), an account
 * that already held vessels looks over the cap, and a grace clock starts.
 * Seconds later the tier event lands, reconciles against the real tier, and
 * clears it. Notifying the instant a clock starts would email an owner about
 * a grace period that had already stopped existing.
 *
 * So the notification is driven by state and confirmed against Stripe:
 *
 *  1. It is evaluated after EVERY reconcile, not just the one that started
 *     the clock — so it does not depend on catching the start, and a retried
 *     or out-of-order delivery re-evaluates rather than losing the moment.
 *  2. The overflow is re-measured against the tier STRIPE says the account
 *     is on right now, not the stored tier. At the racing moment Stripe
 *     already has the Full subscription; the stored tier just has not caught
 *     up. Measured against Stripe, there is no overflow, nothing is sent, and
 *     the tier event clears the clock. If Stripe does confirm the overflow,
 *     the clock is real.
 *  3. The send is claimed in the database first (users.downgrade_grace_
 *     notified_for), so one clock is notified exactly once however many
 *     reconciles evaluate it, concurrently or not.
 */

export type SubscriptionSummary = { id: string; status: string; created: number; priceId: string | null };

const LIVE = new Set(["active", "trialing", "past_due"]);

/**
 * The tier an account is on according to Stripe, or null when Stripe cannot
 * say (no subscription, or a price that matches neither tier).
 *
 * A live subscription wins. Failing that, the newest incomplete one — the
 * plan being bought at the racing moment, when Stripe may not yet have moved
 * it to active. Anything else (cancelled, expired) describes nothing current.
 */
export function tierFromSubscriptions(
  subscriptions: SubscriptionSummary[],
  tierForPriceId: (priceId: string | null) => SubscriptionTier | null,
): SubscriptionTier | null {
  const newestFirst = [...subscriptions].sort((a, b) => b.created - a.created);
  for (const pool of [newestFirst.filter((s) => LIVE.has(s.status)), newestFirst.filter((s) => s.status === "incomplete")]) {
    for (const s of pool) {
      const tier = tierForPriceId(s.priceId);
      if (tier) return tier;
    }
  }
  return null;
}

export type GraceNotificationDecision =
  | { notify: true; limit: number }
  | { notify: false; reason: "no_clock" | "already_notified" | "not_over_confirmed_tier"; limit?: number };

export function decideGraceNotification(input: {
  graceUntil: string | null;
  notifiedFor: string | null;
  activeCount: number;
  /** The tier confirmed against Stripe, falling back to the stored tier only when Stripe has none. */
  tier: SubscriptionTier;
}): GraceNotificationDecision {
  if (!input.graceUntil) return { notify: false, reason: "no_clock" };
  if (input.notifiedFor && new Date(input.notifiedFor).getTime() === new Date(input.graceUntil).getTime()) {
    return { notify: false, reason: "already_notified" };
  }
  const limit = VESSEL_LIMIT[input.tier];
  if (!(input.activeCount > limit)) return { notify: false, reason: "not_over_confirmed_tier", limit };
  return { notify: true, limit };
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

function longDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

/** Quotes the stored deadline, not a day count that goes stale if the email is read later. */
export function graceStartedMessage(input: { activeCount: number; tier: SubscriptionTier; graceUntil: string }): string {
  const limit = VESSEL_LIMIT[input.tier];
  return (
    `You have ${plural(input.activeCount, "active vessel", "active vessels")}, and ${TIER_LABELS[input.tier]} covers ${limit}. ` +
    `Choose which stay active, or upgrade, by ${longDate(input.graceUntil)}.`
  );
}

export function vesselsLockedMessage(count: number): string {
  return `${plural(count, "vessel on your account has", "vessels on your account have")} been paused, because your plan covers fewer vessels than you have and the time to choose has ended.`;
}

export function vesselsRestoredMessage(count: number): string {
  return `${plural(count, "vessel is", "vessels are")} active again now that your subscription is back.`;
}

export function vesselReactivatedByMoxieMessage(mxeId: string): string {
  return `Moxie has reactivated ${mxeId}. It is active on your account again.`;
}

/**
 * RPC RESULT SHAPES, OLD AND NEW.
 *
 * Pushes deploy before migrations are run, so these accept the shape each
 * function returns before 20261003 as well as after it, and never throw on
 * either. What they cannot know from an old shape, they do not guess.
 */

function uuidList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * reconcile_owner_dormancy: UUID[] of locked vessels (20261002), or
 * {locked_ids, lapsed_ids} (20261003).
 */
export function parseOwnerDormancyResult(data: unknown): { lockedIds: string[]; lapsedIds: string[] } {
  if (Array.isArray(data)) return { lockedIds: uuidList(data), lapsedIds: [] };
  if (data && typeof data === "object") {
    const o = data as { locked_ids?: unknown; lapsed_ids?: unknown };
    return { lockedIds: uuidList(o.locked_ids), lapsedIds: uuidList(o.lapsed_ids) };
  }
  return { lockedIds: [], lapsedIds: [] };
}

/**
 * clear_vessels_lapsed: UUID[] of restored vessels (20261002), or
 * {restored_ids, recovered_from_past_due} (20261003).
 *
 * The old shape cannot say whether the restore followed a recovered payment,
 * so it reports false — the in-app-only behaviour that applied before the
 * split — rather than emailing on a guess.
 */
export function parseClearLapsedResult(data: unknown): { restoredIds: string[]; recoveredFromPastDue: boolean } {
  if (Array.isArray(data)) return { restoredIds: uuidList(data), recoveredFromPastDue: false };
  if (data && typeof data === "object") {
    const o = data as { restored_ids?: unknown; recovered_from_past_due?: unknown };
    return { restoredIds: uuidList(o.restored_ids), recoveredFromPastDue: o.recovered_from_past_due === true };
  }
  return { restoredIds: [], recoveredFromPastDue: false };
}

/** The past-due grace ran out without the payment going through. */
export function vesselsLapsedAfterPaymentFailureMessage(count: number): string {
  return (
    `Your payment still hasn't gone through, so ${plural(count, "vessel on your account is", "vessels on your account are")} now paused. ` +
    `Update your payment method to restore ${count === 1 ? "it" : "them"}.`
  );
}

/** A failed payment went through on its own — nobody was watching it happen. */
export function vesselsRecoveredMessage(count: number): string {
  return `Your payment has gone through, so ${plural(count, "paused vessel is", "paused vessels are")} active again.`;
}
