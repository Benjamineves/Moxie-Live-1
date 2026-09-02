/**
 * Single source of truth for every tier-dependent number and price
 * reference in the app. Change a value here, not at the call site.
 *
 * SQL side: three Postgres functions (reactivate_vessel,
 * accept_ownership_transfer, reverse_ownership_transfer) enforce the
 * same vessel cap and can't import this file, so VESSEL_LIMIT is
 * mirrored in supabase/migrations/20260910_tier_structure.sql's
 * vessel_limit_for_tier() SQL function. Keep both in sync by hand.
 */

export type SubscriptionTier = "basic" | "full";

/** Vessels per account. Mirrored in vessel_limit_for_tier() (SQL). */
export const VESSEL_LIMIT: Record<SubscriptionTier, number> = {
  basic: 2,
  full: 5,
};

/**
 * Documents per vessel on Basic (registration + insurance today).
 * Full tier has no per-document count limit — see FULL_STORAGE_CAP_BYTES
 * instead. Boater card is always exempt regardless of tier — a personal
 * operator credential, not vessel equipment.
 */
export const BASIC_DOCUMENT_LIMIT = 3;

/** Total Storage (docs + photos) per account, Full tier only. */
export const FULL_STORAGE_CAP_BYTES = 500 * 1024 * 1024;

/**
 * Dollar amounts below are the single numeric source every price display
 * in the app reads from (badge-fee checkout, the bundled signup
 * checkout, the plan picker, the transfer-fee checkout) — none of those
 * should hardcode their own copy of a number that lives here. They are
 * still documentation only in the sense that the actual charge always
 * comes from the Stripe Price object the matching env var points to;
 * update BOTH the number here and the Stripe Price together when a price
 * changes, or the display and the real charge will disagree again.
 */
export const BADGE_FEE_AMOUNT_USD = 29;
export const SUBSCRIPTION_AMOUNT_USD: Record<SubscriptionTier, number> = {
  basic: 59,
  full: 149,
};
export const TRANSFER_FEE_AMOUNT_USD: Record<SubscriptionTier, number> = {
  basic: 49,
  full: 25,
};

export const PRICE_REFERENCE = {
  badgeFee: {
    envVar: "STRIPE_PRICE_ID_BADGE",
    amount: `$${BADGE_FEE_AMOUNT_USD} one-time, per vessel`,
  },
  basicSubscription: {
    envVar: "STRIPE_PRICE_ID_BASIC_SUBSCRIPTION",
    amount: `$${SUBSCRIPTION_AMOUNT_USD.basic}/year`,
  },
  fullSubscription: {
    envVar: "STRIPE_PRICE_ID_FULL",
    amount: `$${SUBSCRIPTION_AMOUNT_USD.full}/year`,
  },
  transferFeeBasicSeller: {
    envVar: "STRIPE_PRICE_ID_TRANSFER_BASIC",
    amount: `$${TRANSFER_FEE_AMOUNT_USD.basic}`,
  },
  transferFeeFullSeller: {
    envVar: "STRIPE_PRICE_ID_TRANSFER_FULL",
    amount: `$${TRANSFER_FEE_AMOUNT_USD.full}`,
  },
} as const;

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  basic: "Basic",
  full: "Full Access",
};
