"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The owner's explicit "choose which vessels stay active" action —
 * available any time there's Basic-tier overflow, not just during the
 * 14-day grace window (dormant identity spec §5/§6). Thin wrapper around
 * choose_active_vessels() (supabase/migrations/20260913_dormant_identity.sql),
 * which does the real validation (cap check, ownership check) atomically.
 */
export async function chooseActiveVessels(vesselIds: string[]): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  // The canonical owner id is the users row matched by email, not
  // auth.uid() — same resolution every other owner-scoped action in this
  // app uses (see resolveOwnerIds), needed here as a single id rather
  // than a candidate list since this operates on the whole fleet, not
  // one already-resolved vessel.
  const normalizedEmail = user.email?.trim().toLowerCase();
  let ownerId = user.id;
  if (normalizedEmail) {
    const { data: ownerByEmailRow } = await service.from("users").select("id").eq("email", normalizedEmail).maybeSingle();
    const ownerByEmail = ownerByEmailRow as { id: string } | null;
    if (ownerByEmail?.id) ownerId = ownerByEmail.id;
  }

  const { error } = await service.rpc("choose_active_vessels", {
    p_owner_id: ownerId,
    p_vessel_ids: vesselIds,
  });
  if (error) return { error: error.message };
  return {};
}
