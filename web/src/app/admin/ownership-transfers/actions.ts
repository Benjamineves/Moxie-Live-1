"use server";

import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Admin-only, post-completion reversal via reverse_ownership_transfer
 * (20260908_ownership_transfer.sql) — atomically flips owner_id back to
 * the seller with the same advisory-locked cap check acceptance uses,
 * and deliberately does not touch the live vessel row's field values
 * (undoes ownership, not content).
 */
export async function reverseOwnershipTransfer(transferId: string): Promise<{ error?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = requireSupabaseServiceClient("/app/admin/ownership-transfers/actions");
  const { error } = await service.rpc("reverse_ownership_transfer", {
    p_transfer_id: transferId,
    p_admin_email: admin.email,
  });

  if (error) return { error: error.message };
  return {};
}
