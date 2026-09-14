import type { SubscriptionTier } from "../tier-config.ts";

/**
 * Which tier (if either) a Stripe Price id corresponds to — the single place
 * the webhook and the grace notifier ask this question. Moved here from the
 * webhook so the notifier can confirm an account's tier against Stripe
 * without importing a route file.
 */
export function tierForPriceId(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_FULL?.trim()) return "full";
  if (priceId === process.env.STRIPE_PRICE_ID_BASIC_SUBSCRIPTION?.trim()) return "basic";
  return null;
}
