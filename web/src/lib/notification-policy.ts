import { DORMANCY } from "./tier-config.ts";

/**
 * WHICH NOTIFICATIONS EMAIL, AND HOW OFTEN.
 *
 * Its own module rather than a block inside notify.ts for two reasons.
 * It is a product decision that will be revisited, and it should be
 * readable without reading a send path. And notify.ts imports the email
 * templates while the templates need to know which types are emailable —
 * a cycle that disappears once both depend on this instead of each
 * other.
 *
 * Nothing here has any dependency beyond tier-config, so it can be read
 * and tested on its own.
 */
export type NotificationType =
  | "subscription_past_due"
  | "vessel_lapsed"
  | "downgrade_grace_started"
  | "vessel_locked"
  | "vessel_reactivated"
  | "vessel_reactivated_by_moxie"
  | "transfer_accepted"
  | "transfer_declined_or_expired"
  | "transfer_completed_seller"
  | "transfer_completed_buyer";

export const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * How a repeat EMAIL is recognised. The in-app row is always written
 * whichever of these applies.
 *
 * The two strategies differ in kind, not degree, which is why this is a
 * union rather than a window that some types set to zero:
 *
 * - "window" absorbs a provider redelivering the same event. Repeats are
 *   the same episode BECAUSE they are close together, so time is the
 *   right axis.
 * - "key" is for events that happen once and are identified by the thing
 *   they are about. A seller who cancels a transfer and starts another
 *   to the same buyer has begun a genuinely new episode, and no amount
 *   of elapsed time distinguishes it — only the transfer id does.
 */
export type DedupeStrategy =
  | { mode: "window"; windowMs: number }
  | { mode: "key" }
  | { mode: "none" };

export type NotificationPolicy = {
  /** Whether this type emails in addition to its in-app row. */
  email: boolean;
  dedupe: DedupeStrategy;
  /** Why this type is set the way it is. */
  why: string;
};

/**
 * Per-type policy, in one readable place because it is a product
 * decision that will be revisited — not an inline condition to be
 * rediscovered by whoever next reads the send path.
 *
 * EVERY TYPE RECORDS AN IN-APP ROW. This map only governs email.
 *
 * The dedupe windows are not a single global number, because the thing
 * being deduplicated differs by type. Each window is the period over
 * which a repeat delivery is describing the SAME episode, which is the
 * grace period the message itself talks about. That matters beyond
 * noise: these messages quote a fixed number of days from tier-config,
 * so a repeat send on day three would still say "you have 7 days" when
 * the owner has four. A duplicate is not just annoying, it is wrong.
 */
export const NOTIFICATION_POLICY: Record<NotificationType, NotificationPolicy> = {
  subscription_past_due: {
    email: true,
    dedupe: { mode: "window", windowMs: DORMANCY.PAST_DUE_GRACE_DAYS * DAY_MS },
    why: "One email per payment-failure episode. Stripe retries webhook delivery and re-sends past_due through its dunning cycle; all of that is one failed payment to the owner, and the grace period is how long that episode lasts.",
  },
  vessel_lapsed: {
    email: true,
    dedupe: { mode: "window", windowMs: 7 * DAY_MS },
    why: "Terminal event, so there is no grace period to anchor to. A week covers every webhook retry. The cost is that a cancel-resubscribe-cancel inside one week emails once; the in-app row still records both.",
  },
  downgrade_grace_started: {
    email: true,
    dedupe: { mode: "none" },
    why: "Once per grace clock, and the database decides that, not a window: the send is claimed by setting users.downgrade_grace_notified_for to the clock's deadline, so concurrent or repeated reconciles send one email, and a clock that clears and later restarts is a new episode that emails again — a 14-day window would have wrongly suppressed it. Sent only when Stripe confirms the overflow, so the signup-bundle race (a clock started against a tier seconds out of date) never emails. See lib/dormancy-notifications.ts.",
  },
  vessel_locked: {
    email: true,
    dedupe: { mode: "none" },
    why: "Once per account per lock, naming the count — a downgrade that pauses four boats sends one email, not four. No window needed: apply_overflow_fallback returns the locked ids only to the call that locked them, so a repeat call (another page load, the admin sweep) has nothing to report.",
  },
  transfer_accepted: {
    email: true,
    dedupe: { mode: "key" },
    why: "The seller is away from the app — they sent a link and are waiting. Acceptance is also the point the transfer fee becomes payable, so it is the outcome they most need to hear.",
  },
  transfer_declined_or_expired: {
    email: true,
    dedupe: { mode: "key" },
    why: "A transfer that quietly stopped is worse than one that failed loudly: the seller believes a sale is in progress. Expiry is applied lazily when the buyer opens a stale link, so this can fire from a page render — keying on the transfer id is what makes that safe to repeat.",
  },
  transfer_completed_seller: {
    email: true,
    dedupe: { mode: "key" },
    why: "They have lost a vessel and been charged a fee. Separate from the buyer's message because they are opposite sides of one event and share almost no useful sentence.",
  },
  transfer_completed_buyer: {
    email: true,
    dedupe: { mode: "key" },
    why: "By completion the buyer has an account, so this goes through notifyOwner like any other. They have gained a vessel and need to know what to do with it.",
  },
  vessel_reactivated: {
    email: false,
    dedupe: { mode: "none" },
    why: "Lapsed vessels restored by a resubscription, once per account naming the count. Usually fires while the owner is on the processing screen watching it happen, and emailing a confirmation of what someone just did is noise. Known exception: Stripe recovering an unpaid subscription on a retry, with nobody watching — in-app only for now; not yet decided.",
  },
  vessel_reactivated_by_moxie: {
    email: true,
    dedupe: { mode: "none" },
    why: "An admin reactivated a decommissioned vessel. The owner was not there, and something changed on their account, so they are told by email. One per reactivation: reactivate_vessel refuses a vessel that is not decommissioned, so a repeat cannot succeed twice.",
  },
};

export type EmailableNotificationType = Exclude<NotificationType, "vessel_reactivated">;

export function isEmailableNotification(type: NotificationType): type is EmailableNotificationType {
  return NOTIFICATION_POLICY[type].email;
}
