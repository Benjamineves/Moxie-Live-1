import { getStripe } from "./server";
import type { SubscriptionTier } from "../tier-config";

/**
 * The real amounts behind the checkout, read from the Stripe Price objects
 * rather than from lib/tier-config.ts.
 *
 * Needed because the payment page now mounts Elements in DEFERRED mode —
 * with an amount and currency, and no PaymentIntent until the Pay click
 * (see the note at the top of dashboard/[mxeId]/payment/actions.ts). The
 * amount Elements is mounted with has to describe the intent that will be
 * confirmed into it. tier-config's dollar figures are the display source
 * and are documented as able to drift from the Stripe Price; the charge
 * always comes from the Price. So the Price is what Elements is told.
 *
 * Two functions, not one, on purpose: each checkout reads only the prices
 * it charges. The badge-fee page used to depend on STRIPE_PRICE_ID_BADGE
 * alone, and it still does — a missing plan price must not take down a
 * checkout that never uses one.
 *
 * Reads only. Nothing here creates or changes anything in Stripe.
 */

async function priceCents(envVar: string): Promise<{ cents: number; currency: string }> {
  const id = process.env[envVar]?.trim();
  if (!id) throw new Error(`Missing ${envVar}.`);
  const price = await getStripe().prices.retrieve(id);
  if (!price.unit_amount) throw new Error(`${envVar} has no unit amount configured.`);
  return { cents: price.unit_amount, currency: price.currency };
}

export type BadgeFeeAmount = { currency: string; badgeCents: number };

/** For PaymentForm: an existing subscriber adding a vessel pays the badge fee only. */
export async function getBadgeFeeAmount(): Promise<BadgeFeeAmount> {
  const badge = await priceCents("STRIPE_PRICE_ID_BADGE");
  return { currency: badge.currency, badgeCents: badge.cents };
}

export type BundleAmounts = { currency: string; badgeCents: number; planCents: Record<SubscriptionTier, number> };

/** For SignupBundleForm: plan + badge on one first invoice. */
export async function getBundleAmounts(): Promise<BundleAmounts> {
  const [badge, basic, full] = await Promise.all([
    priceCents("STRIPE_PRICE_ID_BADGE"),
    priceCents("STRIPE_PRICE_ID_BASIC_SUBSCRIPTION"),
    priceCents("STRIPE_PRICE_ID_FULL"),
  ]);
  // One Elements instance takes one currency, and a bundle is plan + badge
  // on a single invoice, so a mismatch is a Stripe configuration error that
  // would fail at confirmation anyway. Better to say so on page load.
  if (basic.currency !== badge.currency || full.currency !== badge.currency) {
    throw new Error(
      `Stripe prices disagree on currency (badge ${badge.currency}, basic ${basic.currency}, full ${full.currency}).`,
    );
  }
  return { currency: badge.currency, badgeCents: badge.cents, planCents: { basic: basic.cents, full: full.cents } };
}

export type PlanAmounts = { currency: string; planCents: Record<SubscriptionTier, number> };

/** For UpgradeForm on /dashboard/upgrade: a plan on its own, no badge. */
export async function getPlanAmounts(): Promise<PlanAmounts> {
  const [basic, full] = await Promise.all([
    priceCents("STRIPE_PRICE_ID_BASIC_SUBSCRIPTION"),
    priceCents("STRIPE_PRICE_ID_FULL"),
  ]);
  // Same reason as getBundleAmounts: one Elements instance, one currency,
  // and a plan change remounts it with the other price.
  if (basic.currency !== full.currency) {
    throw new Error(`Stripe prices disagree on currency (basic ${basic.currency}, full ${full.currency}).`);
  }
  return { currency: basic.currency, planCents: { basic: basic.cents, full: full.cents } };
}

export type TransferFeeAmount = { currency: string; feeCents: number };

/**
 * For TransferPaymentForm: the seller's transfer fee, which depends on the
 * seller's tier — so, unlike the badge fee, it can change between the page
 * loading and the Pay click. createTransferFeeIntent is given this amount
 * back and refuses if the fee has moved, rather than charging a figure the
 * seller was not shown.
 */
export async function getTransferFeeAmount(sellerTier: SubscriptionTier): Promise<TransferFeeAmount> {
  const fee = await priceCents(sellerTier === "full" ? "STRIPE_PRICE_ID_TRANSFER_FULL" : "STRIPE_PRICE_ID_TRANSFER_BASIC");
  return { currency: fee.currency, feeCents: fee.cents };
}
