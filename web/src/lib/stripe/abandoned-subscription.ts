import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "../supabase/schema-stub.ts";

/**
 * WHAT A PAY CLICK DOES WITH THE SUBSCRIPTION ALREADY ON FILE
 *
 * Both checkouts that create a plan subscription — the signup bundle and
 * the plan picker on /dashboard/upgrade — store stripe_subscription_id the
 * moment the subscription exists, before its first invoice is paid. So a
 * Pay click that doesn't finish (a declined card, a closed tab, a plan
 * change followed by a second Pay) leaves a real, unpaid subscription on
 * file. The next Pay click must neither stack a second subscription on top
 * of it nor be blocked by it forever.
 *
 * The plan picker used to skip this entirely and overwrite the stored id,
 * orphaning the previous subscription. It also created that subscription
 * when a plan was chosen, so merely switching plans orphaned one.
 *
 * One helper, so the two checkouts cannot drift apart.
 */

export type StoredSubscriptionAction =
  /** Nothing on file. */
  | "proceed"
  /** Abandoned first invoice — cancel it in Stripe, clear the id, proceed. */
  | "cancel_and_clear"
  /** Already dead in Stripe — nothing to cancel, clear the stale id, proceed. */
  | "clear"
  /** A plan that is (or may still become) live — do not create another. */
  | "refuse";

/**
 * `null` status means there is a stored id but Stripe could not return it
 * (deleted, wrong mode) — stale, so cleared.
 *
 * 'canceled' and 'incomplete_expired' are terminal in Stripe; neither can
 * be paid or revived. Everything else — active, past_due, unpaid, trialing,
 * paused — is a subscription that still describes, or can come back to
 * describe, this account, and a second one would bill it twice.
 */
export function decideStoredSubscription(storedId: string | null, status: Stripe.Subscription.Status | null): StoredSubscriptionAction {
  if (!storedId) return "proceed";
  if (status === null) return "clear";
  if (status === "incomplete") return "cancel_and_clear";
  if (status === "incomplete_expired" || status === "canceled") return "clear";
  return "refuse";
}

export const SUBSCRIPTION_ALREADY_SETTING_UP =
  "A subscription is already being set up for this account. Refresh the page and try again.";

/**
 * Applies decideStoredSubscription. Call at the Pay click, after every
 * check that can refuse the checkout, so a refusal has no side effects in
 * Stripe. Returns an error to show the owner, or null to go ahead.
 */
export async function releaseAbandonedSubscription(
  stripe: Stripe,
  service: SupabaseClient<PermissiveDatabase>,
  owner: { id: string; stripe_subscription_id: string | null },
): Promise<{ error: string } | null> {
  const storedId = owner.stripe_subscription_id;
  if (!storedId) return null;

  let status: Stripe.Subscription.Status | null;
  try {
    status = (await stripe.subscriptions.retrieve(storedId)).status;
  } catch {
    status = null;
  }

  const action = decideStoredSubscription(storedId, status);
  if (action === "refuse") return { error: SUBSCRIPTION_ALREADY_SETTING_UP };
  if (action === "cancel_and_clear") {
    await stripe.subscriptions.cancel(storedId).catch(() => {});
  }
  if (action === "cancel_and_clear" || action === "clear") {
    // Scoped to the id that was read, so a concurrent request that has
    // already stored a newer subscription is not wiped out.
    await service.from("users").update({ stripe_subscription_id: null }).eq("id", owner.id).eq("stripe_subscription_id", storedId);
  }
  return null;
}
