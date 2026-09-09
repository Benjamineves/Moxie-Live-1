"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type StatusActionResult = { advanced?: number; ok?: boolean; error?: string };

/**
 * Advances every live identity in a batch (spec §5.0.4).
 *
 * The precondition that matters — zero identities with artwork_path NULL
 * — is NOT checked here. It lives in advance_badge_batch_status
 * (20260925), because a gate in a server action is a gate that a second
 * caller or a hand-run UPDATE walks around. This function's job is
 * authorization and reporting what the database decided; the UI's job is
 * to show the operator why a button is greyed. Neither is the control.
 */
export async function advanceBatchStatus(
  batchId: string,
  toStatus: "printed" | "in_stock",
): Promise<StatusActionResult> {
  // Re-checked rather than trusting that only the gated page can reach
  // this action, and load-bearing: the service-role client below bypasses
  // RLS entirely, so this check is the only thing between the button and
  // anyone who finds the route.
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  if (toStatus !== "printed" && toStatus !== "in_stock") {
    return { error: "Unsupported transition." };
  }

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data, error } = await service.rpc("advance_badge_batch_status", {
    p_batch_id: batchId,
    p_to_status: toStatus,
  });

  if (error) {
    // The function raises with a message written for a human operator
    // ("38 of 100 identities have no artwork — render them before
    // advancing"). Surfacing it verbatim beats replacing it with a
    // generic failure that hides which precondition bit.
    return { error: error.message };
  }

  revalidatePath(`/admin/badges/${batchId}`);
  revalidatePath("/admin/badges");
  return { advanced: typeof data === "number" ? data : 0 };
}

/**
 * Voids one identity with a reason (spec §5.0.4).
 *
 * Per identity because damage is per object. Assigned identities are
 * refused by the function, not here — see 20260925 for why that is a
 * deliberate narrowing of the spec's "any → void".
 */
export async function voidBadgeIdentity(
  identityId: string,
  reason: string,
  batchId: string,
): Promise<StatusActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const trimmed = reason.trim();
  if (!trimmed) return { error: "A reason is required." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service.rpc("void_badge_identity", {
    p_identity_id: identityId,
    p_reason: trimmed,
  });

  if (error) return { error: error.message };

  revalidatePath(`/admin/badges/${batchId}`);
  revalidatePath("/admin/badges");
  return { ok: true };
}
