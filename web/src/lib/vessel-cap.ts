import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";
import { TIER_LABELS, VESSEL_LIMIT, type SubscriptionTier } from "./tier-config.ts";

/**
 * THE VESSEL CAP, IN ONE PLACE ON THE APP SIDE.
 *
 * Two questions, deliberately kept apart so the one that decides can be
 * tested without a database:
 *
 *  - countActiveVessels: how many vessels this owner has that count.
 *  - evaluateVesselCap: whether one more is allowed.
 *
 * WHAT COUNTS
 *
 * qr_status = 'active' AND lifecycle_status = 'active'. Both, not either:
 * an unpaid vessel has never been active, and a dormant or decommissioned
 * one keeps qr_status = 'active' forever, so qr_status alone cannot tell
 * them apart. This is the same filter vessel_limit_for_tier's callers use
 * in SQL (reconcile_vessel_overflow, accept_ownership_transfer,
 * reactivate_vessel) — change one and the other has to change with it.
 *
 * WHERE IT IS CHECKED, AND WHY THIS IS NOT THE ENFORCEMENT
 *
 * createVessel checks it, and so do both checkout actions — at the Pay
 * click, a second before the charge. Those checks exist so an owner is
 * not charged for something the plan does not cover. They are a courtesy,
 * not the guarantee: two submits in the same second both pass, and any
 * future path that activates a vessel would bypass them entirely.
 *
 * The guarantee is reconcile_vessel_overflow, run after every activation
 * and every completed transfer (the Stripe webhook). It lives in the
 * database and sees the state that actually resulted, regardless of which
 * caller got there or whether its check was right.
 */

export type VesselCapDecision =
  | { allowed: true; limit: number; activeCount: number }
  | { allowed: false; limit: number; activeCount: number; message: string };

export function evaluateVesselCap(input: {
  activeCount: number;
  tier: SubscriptionTier;
  /** Admin accounts bypass the cap, same exemption as is_admin_email() in SQL. */
  capExempt: boolean;
}): VesselCapDecision {
  const limit = VESSEL_LIMIT[input.tier];
  const activeCount = Math.max(0, Math.floor(input.activeCount));
  if (input.capExempt || activeCount < limit) {
    return { allowed: true, limit, activeCount };
  }
  const plural = limit === 1 ? "" : "s";
  return {
    allowed: false,
    limit,
    activeCount,
    message:
      `${TIER_LABELS[input.tier]} covers ${limit} active vessel${plural}, and this account already has ${activeCount}. ` +
      `Nothing has been charged.`,
  };
}

export async function countActiveVessels(
  service: SupabaseClient<PermissiveDatabase>,
  ownerId: string,
): Promise<{ count: number } | { error: string }> {
  const { count, error } = await service
    .from("vessels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("qr_status", "active")
    .eq("lifecycle_status", "active");
  if (error) return { error: error.message };
  return { count: count ?? 0 };
}
