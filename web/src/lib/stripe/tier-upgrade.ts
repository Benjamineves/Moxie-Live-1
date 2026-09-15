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
  /**
   * Paid, but the subscription isn't live. `retryable` when its status can
   * still move back to live (unpaid, paused, incomplete): alert, then throw
   * so Stripe redelivers. Terminal (canceled, incomplete_expired): alert and
   * stop — no redelivery can apply it.
   */
  | { kind: "not_live"; status: string; retryable: boolean }
  /** Paid, but the item or price is not what was quoted. Terminal: alert and stop. */
  | { kind: "mismatch"; reason: string };

const LIVE = new Set(["active", "past_due", "trialing"]);
/** Statuses Stripe never moves a subscription out of. Anything else not live might recover. */
const TERMINAL = new Set(["canceled", "incomplete_expired"]);

/** What invoice.paid does for a paid tier_upgrade invoice, against the subscription as it is now. */
export function decideTierUpgradeCompletion(input: {
  subscriptionStatus: string;
  /** The current price of the item the upgrade was quoted for, or null if the item is gone. */
  itemPriceId: string | null;
  /** metadata.to_price on the paid invoice. */
  toPriceId: string | null;
}): TierUpgradeCompletion {
  if (!LIVE.has(input.subscriptionStatus)) {
    return { kind: "not_live", status: input.subscriptionStatus, retryable: !TERMINAL.has(input.subscriptionStatus) };
  }
  if (!input.toPriceId || tierForPriceId(input.toPriceId) !== "full") return { kind: "mismatch", reason: "to_price is not the Full price" };
  if (input.itemPriceId === null) return { kind: "mismatch", reason: "the quoted subscription item no longer exists" };
  if (input.itemPriceId === input.toPriceId) return { kind: "already_swapped" };
  if (tierForPriceId(input.itemPriceId) !== "basic") return { kind: "mismatch", reason: `item is on ${input.itemPriceId}, not Basic` };
  return { kind: "swap" };
}

function formatMoney(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/**
 * The two messages for a paid upgrade that wasn't applied. The admin's is
 * operational — what to look up and what to do. The owner's says what
 * happened in their terms and promises only what is true: a person has
 * been alerted (the admin row is recorded before the owner's).
 */
export function unappliedUpgradeMessages(input: {
  amountCents: number;
  currency: string;
  invoiceId: string;
  subscriptionId: string | null;
  ownerId: string | null;
  reason: string;
  retrying: boolean;
}): { owner: string; admin: string } {
  const amount = formatMoney(input.amountCents, input.currency);
  const admin =
    `A Full Access upgrade was paid (${amount}, invoice ${input.invoiceId}) but not applied: ${input.reason}. ` +
    `Owner ${input.ownerId ?? "unknown"}, subscription ${input.subscriptionId ?? "unknown"}. The payment is recorded in account_payments. ` +
    (input.retrying
      ? "Stripe is redelivering the event for up to about three days and it will apply on its own if the subscription becomes live again; if it doesn't, refund the invoice in Stripe."
      : "It will not apply on its own. Refund the invoice in Stripe, or apply the upgrade by hand.");
  const owner = input.retrying
    ? `Your ${amount} payment for Full Access was received but hasn't been applied yet, because your plan isn't active right now. The Moxie team has been alerted.`
    : `Your ${amount} payment for Full Access was received but couldn't be applied to your plan. The Moxie team has been alerted.`;
  return { owner, admin };
}

/**
 * THE SAVED CARD, INSIDE THE DEFERRED PATTERN.
 *
 * A Customer Session lets the deferred Payment Element list the customer's
 * saved cards — Stripe.js's no-intent Elements options accept
 * customerSessionClientSecret (StripeElementsOptionsModeBase in the
 * installed @stripe/stripe-js). It creates no payment state: no intent, no
 * invoice, nothing that a second open page could race. The invoice and its
 * PaymentIntent are still created only at the Pay click.
 *
 * - allow_redisplay filter: every saved card read in test mode is
 *   'unspecified' or 'limited' (cards saved through a subscription), and
 *   Stripe's default filter is ['always'] — which shows none of them. The
 *   form this replaced set no filter.
 * - payment_method_save 'disabled': a "save this card" tick would send
 *   setup_future_usage on confirm, which the upgrade invoice's intent (null)
 *   would not match.
 * - payment_method_remove 'disabled': removing a card here could detach the
 *   one the subscription renews on.
 *
 * Only created when the customer has a saved card (listing is a read), so a
 * customer with nothing to show causes no Stripe write at all.
 */
export const SAVED_CARD_SESSION_FEATURES = {
  payment_method_redisplay: "enabled",
  payment_method_allow_redisplay_filters: ["always", "limited", "unspecified"],
  payment_method_redisplay_limit: 3,
  payment_method_save: "disabled",
  payment_method_remove: "disabled",
} as const;

export async function createSavedCardSession(stripe: Stripe, customerId: string): Promise<string | null> {
  const cards = await stripe.customers.listPaymentMethods(customerId, { type: "card", limit: 1 });
  if (cards.data.length === 0) return null;
  const session = await stripe.customerSessions.create({
    customer: customerId,
    components: {
      payment_element: {
        enabled: true,
        features: {
          ...SAVED_CARD_SESSION_FEATURES,
          payment_method_allow_redisplay_filters: [...SAVED_CARD_SESSION_FEATURES.payment_method_allow_redisplay_filters],
        },
      },
    },
  });
  return session.client_secret;
}

/**
 * What the deferred upgrade form mounts with. The action refuses an invoice
 * whose PaymentIntent disagrees, before handing out its client secret.
 * Read in test mode on 2026-09-15, both null: a customer with no saved card
 * (cus_VGTlfcx1RwtwOz) and one with a saved test card, allow_redisplay
 * 'unspecified' (cus_VGUCm4n6lRjsuj). Neither fixture had a subscription;
 * the invoice isn't attached to one.
 */
export const UPGRADE_FORM_SETUP_FUTURE_USAGE = null;
