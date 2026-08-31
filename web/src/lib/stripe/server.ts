import Stripe from "stripe";

let cached: Stripe | undefined;

/**
 * Server-only Stripe client. Unlike the Supabase helpers, this throws rather
 * than returning null when unconfigured — payment code has no meaningful
 * degraded/demo mode to fall back to.
 */
export function getStripe(): Stripe {
  if (cached) return cached;
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) {
    throw new Error("Missing STRIPE_SECRET_KEY.");
  }
  cached = new Stripe(key);
  return cached;
}
