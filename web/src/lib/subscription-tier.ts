import type Stripe from "stripe";
import { tierForPriceId } from "./stripe/tiers.ts";
import type { SubscriptionTier } from "./tier-config.ts";

/**
 * THE TIER FOLLOWS WHAT WAS PAID, NOT THE PRICE ON THE SUBSCRIPTION.
 *
 * The webhook used to read users.subscription_tier off the subscription's
 * current item price, on both invoice.paid and customer.subscription.updated.
 * A price on a subscription is not a payment. Stripe applies an item swap
 * the moment it is requested — observed in this account's event log: the
 * Basic -> Full upgrade swapped sub_1UBKTY… at 21:09:06 and its invoice was
 * paid at 21:09:30, and sub_1UBJeT… has sat on the Full price since 2 Sept
 * with its proration never invoiced. Either way the swap's own
 * customer.subscription.updated wrote Full before, or without, payment.
 *
 * So:
 *  - customer.subscription.updated sets status only. It never writes a tier.
 *  - invoice.paid writes the tier the PAID INVOICE charged for, read from its
 *    lines — never from the subscription, which may since have moved.
 *  - Cancellation still writes Basic (the lapse branch in the webhook).
 */

/**
 * The account update for a subscription that is active now. Status only.
 * It takes no subscription on purpose: nothing on it may decide the tier.
 */
export function accountUpdateForActiveSubscription(): { subscription_status: "active" } {
  return { subscription_status: "active" };
}

type PlanLine = { tier: SubscriptionTier; amount: number; proration: boolean };

function planLines(invoice: Stripe.Invoice): PlanLine[] {
  const out: PlanLine[] = [];
  for (const line of invoice.lines?.data ?? []) {
    const price = line.pricing?.price_details?.price;
    const tier = tierForPriceId(typeof price === "string" ? price : price?.id);
    // Only plan prices decide. A badge fee line maps to no tier.
    if (!tier) continue;
    const details = line.parent?.subscription_item_details ?? line.parent?.invoice_item_details;
    out.push({ tier, amount: line.amount, proration: details?.proration ?? false });
  }
  return out;
}

function single(tiers: SubscriptionTier[]): SubscriptionTier | null {
  const distinct = new Set(tiers);
  return distinct.size === 1 ? tiers[0] : null;
}

/**
 * The tier a paid subscription invoice paid for, or null if it doesn't say.
 *
 *  1. A non-proration plan line — a signup or a renewal — is the period
 *     that was bought. It wins over any prorations the invoice swept up.
 *  2. Otherwise, a proration invoice: the tier of its positive proration
 *     lines, the remaining time that was charged for. (The credit lines are
 *     negative and name the tier being left.)
 *  3. No plan line, or lines naming both tiers: null, and the stored tier
 *     is left alone.
 *
 * Only the subscription's LATEST invoice decides. Stripe redelivers for up
 * to ~3 days and out of order, so an older invoice arriving after a newer
 * one (a renewal delivered after an upgrade was paid) would otherwise
 * write the tier that was superseded. `subscription` is the one retrieved
 * now, not the event's copy; its price is never read.
 *
 * `invoice` must carry ALL its lines (the webhook fetches the rest when
 * `lines.has_more`).
 */
export function tierForPaidInvoice(invoice: Stripe.Invoice, subscription: Stripe.Subscription): SubscriptionTier | null {
  const latest = typeof subscription.latest_invoice === "string" ? subscription.latest_invoice : subscription.latest_invoice?.id;
  if (latest !== invoice.id) return null;

  const lines = planLines(invoice);
  const periods = lines.filter((l) => !l.proration);
  if (periods.length > 0) return single(periods.map((l) => l.tier));
  const charged = lines.filter((l) => l.proration && l.amount > 0);
  if (charged.length > 0) return single(charged.map((l) => l.tier));
  return null;
}
