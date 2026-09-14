/**
 * WHAT A SUBSCRIPTION EVENT SHOULD DO TO AN ACCOUNT.
 *
 * Pure, so the part of the Stripe webhook that decides can be tested
 * without Stripe or a database.
 *
 * WHY THIS EXISTS: RETRY SAFETY IS NOT SYMMETRIC
 *
 * The other webhook handlers act on one-way state. A vessel goes
 * pending -> active, a transfer goes awaiting_payment -> completed, and
 * both writes are guarded on the "before" state. A retry that arrives
 * days late finds the work done and does nothing.
 *
 * Subscription status is not one-way. It goes active -> past_due ->
 * active -> canceled, and the handler used to write whatever status the
 * EVENT carried. Stripe retries a failed delivery with backoff for up to
 * about three days, and does not promise delivery order even without
 * retries. So making the handler fail loudly — which it must, because a
 * swallowed clear_vessels_lapsed failure leaves a paying owner's vessels
 * paused — would, on its own, let a three-day-old "active" event land
 * after the subscription was cancelled and hand a lapsed account its
 * vessels back.
 *
 * Two rules make any delivery — first, retried, or out of order — safe:
 *
 * 1. Act on the subscription's CURRENT status, retrieved from Stripe when
 *    the event is processed, never on the snapshot inside the event.
 *    Every delivery then converges on the truth instead of on history.
 *
 * 2. A subscription that is no longer live does not get to downgrade an
 *    account that another live subscription is paying for. Account
 *    writes are scoped by Stripe customer, so without this a late
 *    cancellation of an OLD subscription, arriving after the owner
 *    resubscribed, would lapse the account the NEW subscription covers.
 */

export type SubscriptionSyncAction =
  /** Stripe's dunning is exhausted: lapse the account's vessels. */
  | { kind: "lapse" }
  /** Payment failed: start the past-due grace clock. */
  | { kind: "past_due" }
  /** Paying: restore lapsed vessels and reconcile the cap. */
  | { kind: "active" }
  /** Not live, but another subscription is — this one no longer describes the account. */
  | { kind: "superseded"; by: string }
  /** A status this app does not act on (incomplete, trialing, paused, …). */
  | { kind: "ignore" };

/** Statuses under which a subscription is still the thing the account is paying through. */
const LIVE = new Set(["active", "trialing", "past_due"]);

export function decideSubscriptionSync(input: {
  /** The subscription's status as retrieved from Stripe now — not the event's copy. */
  currentStatus: string;
  /** Every OTHER subscription on the same Stripe customer, with its current status. */
  otherSubscriptions: { id: string; status: string }[];
}): SubscriptionSyncAction {
  const { currentStatus } = input;

  // Active always applies. A paying subscription describes the account no
  // matter what else exists, and restoring is what a paying owner is owed.
  if (currentStatus === "active") return { kind: "active" };

  if (currentStatus === "canceled" || currentStatus === "unpaid" || currentStatus === "past_due") {
    const live = input.otherSubscriptions.find((s) => LIVE.has(s.status));
    if (live) return { kind: "superseded", by: live.id };
    return currentStatus === "past_due" ? { kind: "past_due" } : { kind: "lapse" };
  }

  return { kind: "ignore" };
}
