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
 * Dollar amounts below are documentation only — every actual charge
 * comes from the Stripe Price object the named env var points to.
 * Update the comment here when a price changes in Stripe so the two
 * stay readable together; changing the comment alone changes nothing.
 */
export const PRICE_REFERENCE = {
  badgeFee: {
    envVar: "STRIPE_PRICE_ID_BADGE",
    amount: "$29 one-time, per vessel",
  },
  basicSubscription: {
    envVar: "STRIPE_PRICE_ID_BASIC_SUBSCRIPTION",
    amount: "$59/year",
  },
  fullSubscription: {
    envVar: "STRIPE_PRICE_ID_FULL",
    amount: "$149/year",
  },
  transferFeeBasicSeller: {
    envVar: "STRIPE_PRICE_ID_TRANSFER_BASIC",
    amount: "$49",
  },
  transferFeeFullSeller: {
    envVar: "STRIPE_PRICE_ID_TRANSFER_FULL",
    amount: "$25",
  },
} as const;

export const TIER_LABELS: Record<SubscriptionTier, string> = {
  basic: "Basic",
  full: "Full Access",
};
