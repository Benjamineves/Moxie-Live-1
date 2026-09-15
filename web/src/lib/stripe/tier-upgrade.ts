import type Stripe from "stripe";
import { tierForPriceId } from "./tiers.ts";

/**
 * BASIC -> FULL, PAID BEFORE ANYTHING ON THE SUBSCRIPTION CHANGES.
 *
 * The upgrade used to swap the subscription item to the Full price, then
 * invoice the proration. Stripe applies a swap when it is requested
 * (observed: sub_1UBKTY… swapped at 21:09:06 on 2 Sept, paid at 21:09:30),
 * so an owner who asked to see the total and walked away was left on the
 * Full price in Stripe — and their next renewal charged for Full.
 *
 * Now, in order:
 *  1. Page load: quoteTierUpgrade — invoices.createPreview, a read — gives
 *     the amount shown, computed as of a fixed proration_date.
 *  2. Pay click: quote again with the SAME proration_date. The amount must
 *     match what the owner was shown, or the checkout refuses. Then a
 *     standalone, card-only invoice for exactly that amount, finalized with
 *     auto-collection off. The deferred form confirms its PaymentIntent.
 *  3. invoice.paid (metadata.payment_type = 'tier_upgrade'): record the
 *     payment, swap the item with proration_behavior 'none' — the proration
 *     was just paid — and write Full.
 *
 * The standalone invoice's PaymentIntent was read in test mode on
 * 2026-09-15 (fixture customer cus_VGTlfcx1RwtwOz, invoice voided):
 * setup_future_usage null, payment_method_types ['card'] — the same shape
 * the badge fee's deferred form confirms. A subscription invoice's intent
 * carries setup_future_usage 'off_session' instead, which is why this is
 * not attached to the subscription.
 */

export const TIER_UPGRADE_PAYMENT_TYPE = "tier_upgrade";

/** How old a quote's proration_date may be at the Pay click. */
export const QUOTE_MAX_AGE_SECONDS = 60 * 60;

/**
 * The proration_date comes back from the client, so it is bounded. A later
 * date than the one quoted would charge less (less remaining time); any date
 * in the future is refused. An hour-old date charges up to an hour more of
 * the price difference than a fresh one — cents — and older than that the
 * owner reloads.
 */
export function checkProrationDate(input: {
  prorationDate: unknown;
  now: number;
  periodStart: number;
  periodEnd: number;
}): string | null {
  const { prorationDate, now, periodStart, periodEnd } = input;
  if (typeof prorationDate !== "number" || !Number.isInteger(prorationDate)) return "invalid";
  if (prorationDate > now) return "future";
  if (now - prorationDate > QUOTE_MAX_AGE_SECONDS) return "stale";
  if (prorationDate < periodStart || prorationDate >= periodEnd) return "outside_period";
  return null;
}

/**
 * The upgrade's own proration from a preview: lines for this subscription
 * item, marked proration, whose period starts at the quoted proration_date.
 *
 * The period filter matters. A preview with always_invoice also sweeps in
 * proration items already pending on the subscription — observed on
 * sub_1UBJeT…, whose preview carried its two uninvoiced 2 Sept items
 * (period start 1788381812) beside the new ones (period start = the
 * proration_date). Those are not this upgrade's to charge.
 */
export function upgradeProrationCents(lines: Stripe.InvoiceLineItem[], itemId: string, prorationDate: number): number {
  let total = 0;
  for (const line of lines) {
    const details = line.parent?.subscription_item_details;
    if (!details?.proration || details.subscription_item !== itemId) continue;
    if (line.period?.start !== prorationDate) continue;
    total += line.amount;
  }
  return total;
}

export type TierUpgradeQuote = {
  amountCents: number;
  currency: string;
  prorationDate: number;
  subscriptionId: string;
  subscriptionItemId: string;
  customerId: string;
  fullPriceId: string;
};

/** Reads only: subscriptions.retrieve and invoices.createPreview. */
export async function quoteTierUpgrade(
  stripe: Stripe,
  input: { subscriptionId: string; prorationDate: number; now: number },
): Promise<TierUpgradeQuote | { error: string; code?: "STALE_QUOTE" }> {
  const fullPriceId = process.env.STRIPE_PRICE_ID_FULL?.trim();
  if (!fullPriceId) return { error: "Missing STRIPE_PRICE_ID_FULL." };

  const subscription = await stripe.subscriptions.retrieve(input.subscriptionId);
  if (subscription.status !== "active") {
    return { error: `Your plan is '${subscription.status}', not active — it can't be upgraded right now.` };
  }
  const item = subscription.items.data[0];
  if (!item) return { error: "Could not find your subscription's plan item." };
  const tier = tierForPriceId(item.price.id);
  if (tier === "full") return { error: "Already on Full Access." };
  if (tier !== "basic") return { error: "Your subscription isn't on a plan this page can upgrade." };

  const dateProblem = checkProrationDate({
    prorationDate: input.prorationDate,
    now: input.now,
    periodStart: item.current_period_start,
    periodEnd: item.current_period_end,
  });
  if (dateProblem) {
    return { error: "This upgrade total has expired. Reload the page to see the current amount.", code: "STALE_QUOTE" };
  }

  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const preview = await stripe.invoices.createPreview({
    customer: customerId,
    subscription: subscription.id,
    subscription_details: {
      items: [{ id: item.id, price: fullPriceId }],
      proration_behavior: "always_invoice",
      proration_date: input.prorationDate,
    },
  });
  if (preview.lines.has_more) {
    // A plan subscription's preview is a handful of lines. Refusing beats
    // charging a total computed from part of them.
    return { error: "Stripe returned more proration lines than expected. Nothing has been charged." };
  }
  const amountCents = upgradeProrationCents(preview.lines.data, item.id, input.prorationDate);
  if (amountCents <= 0) {
    return { error: "There's nothing to charge for this upgrade. Contact support rather than paying." };
  }

  return {
    amountCents,
    currency: preview.currency,
    prorationDate: input.prorationDate,
    subscriptionId: subscription.id,
    subscriptionItemId: item.id,
    customerId,
    fullPriceId,
  };
}

export type TierUpgradeCompletion =
  /** Item still on its old price: swap it, then write Full. */
  | { kind: "swap" }
  /** Already on the Full price (a redelivery after the swap): write Full. */
  | { kind: "already_swapped" }
  /** Paid, but the subscription is no longer live. Recorded; refund by hand. */
  | { kind: "not_live" }
  /** Paid, but the item or price is not what was quoted. Recorded; resolve by hand. */
  | { kind: "mismatch"; reason: string };

const LIVE = new Set(["active", "past_due", "trialing"]);

/** What invoice.paid does for a paid tier_upgrade invoice, against the subscription as it is now. */
export function decideTierUpgradeCompletion(input: {
  subscriptionStatus: string;
  /** The current price of the item the upgrade was quoted for, or null if the item is gone. */
  itemPriceId: string | null;
  /** metadata.to_price on the paid invoice. */
  toPriceId: string | null;
}): TierUpgradeCompletion {
  if (!LIVE.has(input.subscriptionStatus)) return { kind: "not_live" };
  if (!input.toPriceId || tierForPriceId(input.toPriceId) !== "full") return { kind: "mismatch", reason: "to_price is not the Full price" };
  if (input.itemPriceId === null) return { kind: "mismatch", reason: "the quoted subscription item no longer exists" };
  if (input.itemPriceId === input.toPriceId) return { kind: "already_swapped" };
  if (tierForPriceId(input.itemPriceId) !== "basic") return { kind: "mismatch", reason: `item is on ${input.itemPriceId}, not Basic` };
  return { kind: "swap" };
}
