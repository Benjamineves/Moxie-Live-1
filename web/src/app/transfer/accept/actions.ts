"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Buyer's half of Ownership Transfer acceptance. Enforces the email
 * match here (the transfer's buyer_email, set by the seller, vs. the
 * authenticated session's email) — the atomic accept_ownership_transfer
 * RPC trusts that's already been checked and focuses purely on the cap
 * race, so this check has to happen before it's called, not instead of.
 *
 * Ensures a users row exists for the buyer, same upsert pattern as
 * dashboard/new/actions.ts's createVessel — a buyer accepting their
 * first-ever Moxie vessel via transfer never went through that path, so
 * there may be no users row for them yet at all.
 */
export async function acceptOwnershipTransfer(transferId: string): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user?.email) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, buyer_email, status")
    .eq("id", transferId)
    .maybeSingle();
  const transfer = transferRow as { id: string; buyer_email: string; status: string } | null;
  if (!transfer) return { error: "Transfer not found." };

  const normalizedEmail = user.email.trim().toLowerCase();
  if (transfer.buyer_email !== normalizedEmail) {
    return { error: `Sign in as ${transfer.buyer_email} to accept this transfer.` };
  }
  if (transfer.status !== "pending") {
    return { error: `This transfer is no longer awaiting acceptance (status: ${transfer.status}).` };
  }

  const { data: existingOwnerByEmail } = await service
    .from("users")
    .select("id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  let buyerId = (existingOwnerByEmail as { id: string } | null)?.id ?? null;

  if (!buyerId) {
    const fullNameFromEmail = normalizedEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Vessel Owner";
    const ownerName = fullNameFromEmail
      .split(" ")
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");

    const { error: upsertError } = await service.from("users").upsert(
      { id: user.id, email: normalizedEmail, full_name: ownerName, role: "owner" },
      { onConflict: "id" },
    );
    if (upsertError) return { error: `Unable to initialize your account: ${upsertError.message}` };
    buyerId = user.id;
  }

  const { error } = await service.rpc("accept_ownership_transfer", {
    p_transfer_id: transferId,
    p_buyer_id: buyerId,
  });
  if (error) return { error: error.message };
  return {};
}
