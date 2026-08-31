import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Extracted out of owner-actions.ts so it can be shared with plain Route
 * Handlers (e.g. the share API endpoints) too — owner-actions.ts is a
 * "use server" module, and every export from a file like that becomes a
 * client-callable Server Action, which isn't the right surface for an
 * internal auth-resolution helper.
 */
export async function resolveOwnerIds(authClient: NonNullable<Awaited<ReturnType<typeof createSupabaseServerClient>>>) {
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { user: null, ownerIds: [] as string[] };

  const service = createSupabaseServiceClient();
  const ownerIds = [user.id];
  const normalizedEmail = user.email?.trim().toLowerCase();
  if (service && normalizedEmail) {
    const { data: ownerByEmailRow } = await service
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const ownerByEmail = ownerByEmailRow as { id: string } | null;
    if (ownerByEmail?.id && ownerByEmail.id !== user.id) ownerIds.push(ownerByEmail.id);
  }
  return { user, ownerIds };
}

export async function loadOwnedVessel(
  service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  mxeId: string,
  ownerIds: string[],
) {
  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as { id: string; owner_id: string } | null;
  if (!vessel || !ownerIds.includes(vessel.owner_id)) return null;
  return vessel;
}
