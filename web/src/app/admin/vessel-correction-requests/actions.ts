"use server";

import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Applies the requested value to the vessel and resolves the request in
 * one atomic step, via the apply_vessel_identity_correction Postgres
 * function (see migration 20260901_apply_vessel_identity_correction.sql)
 * — a request can never end up resolved without the value having
 * actually changed, or vice versa. No fallback on RPC failure: a failed
 * apply should surface as a failure, not quietly resolve the request
 * anyway. The function's own UPDATE to vessels fires the identity audit
 * trigger as part of the same transaction, and records this admin's
 * email as changed_by.
 */
export async function approveAndApplyCorrection(requestId: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service.rpc("apply_vessel_identity_correction", {
    p_request_id: requestId,
    p_admin_email: admin.email,
  });

  if (error) return { error: error.message };
  return {};
}
