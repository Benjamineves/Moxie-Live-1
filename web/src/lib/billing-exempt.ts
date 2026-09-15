/**
 * ACCOUNTS WHOSE PLAN IS SET BY HAND, NOT BY STRIPE.
 *
 * Nothing that reconciles an account's tier or subscription status against
 * Stripe may touch these — not the Stripe webhook, not the downgrade-grace
 * notifier's Stripe lookup, and not the scheduled tier reconciliation that
 * docs/moxie_digital_dormant_identity_spec.md §8 item 1 calls for (not built
 * yet). That job MUST call isTierReconciliationExempt and skip these rows,
 * or its first run will downgrade them: they have no Stripe subscription,
 * so Stripe's answer for them is always "no plan".
 *
 * Keyed by users.id, not by role or email: role = 'admin' can be granted to
 * an account that genuinely pays, and an email can change. Adding an entry
 * here is a decision about one account; say who set it and where.
 */
export const TIER_RECONCILIATION_EXEMPT: readonly { ownerId: string; email: string; why: string }[] = [
  {
    ownerId: "2255a040-7300-407c-bc31-7fb35b383d14",
    email: "admin@moxieyachting.com",
    why:
      "Admin identity. subscription_tier = 'full' and subscription_status = 'active' written by " +
      "supabase/migrations/20260915_second_admin_identity.sql. Has a Stripe customer (created by the " +
      "badge-fee checkout, 2026-09-04) and has never had a Stripe subscription.",
  },
];

const EXEMPT_IDS = new Set(TIER_RECONCILIATION_EXEMPT.map((e) => e.ownerId));

export function isTierReconciliationExempt(ownerId: string | null | undefined): boolean {
  return !!ownerId && EXEMPT_IDS.has(ownerId);
}
