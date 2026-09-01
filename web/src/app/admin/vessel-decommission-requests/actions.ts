"use server";

import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Applies the decommission and resolves the request in one atomic step,
 * via apply_vessel_decommission (see migration
 * 20260906_vessel_decommission.sql) — a request can never end up
 * approved without the vessel's lifecycle_status actually changing and
 * its shares actually being revoked, or vice versa. No fallback on RPC
 * failure: a failed apply should surface as a failure, not quietly
 * resolve the request anyway.
 */
export async function approveDecommission(requestId: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service.rpc("apply_vessel_decommission", {
    p_request_id: requestId,
    p_admin_email: admin.email,
  });

  if (error) return { error: error.message };
  return {};
}

/**
 * Bookkeeping-only — no vessel mutation, unlike approval. Plain UPDATE is
 * fine here since nothing else needs to happen atomically with it.
 */
export async function declineDecommission(requestId: string, declineReason: string | null): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service
    .from("vessel_decommission_requests")
    .update({
      status: "declined",
      resolved_at: new Date().toISOString(),
      resolved_by: admin.email,
      decline_reason: declineReason?.trim() || null,
    })
    .eq("id", requestId)
    .eq("status", "pending");

  if (error) return { error: error.message };
  return {};
}

/**
 * Reactivates a decommissioned vessel via reactivate_vessel, which
 * atomically cap-checks (advisory-locked per owner, so two concurrent
 * reactivations for the same owner can't both slip past the 5-vessel
 * limit) and flips lifecycle_status back to active. A cap-exceeded
 * error from the function surfaces here verbatim — it's already written
 * to be a clear, actionable message.
 */
export async function reactivateVessel(vesselId: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service.rpc("reactivate_vessel", {
    p_vessel_id: vesselId,
    p_admin_email: admin.email,
  });

  if (error) return { error: error.message };
  return {};
}
