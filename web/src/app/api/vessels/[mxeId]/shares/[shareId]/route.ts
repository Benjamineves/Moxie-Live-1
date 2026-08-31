import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";

/**
 * Spec §5: idempotent revoke. Filtering on revoked_at IS NULL means a
 * second call is a true no-op — it doesn't bump the original revoke
 * timestamp — and still returns success either way, so a retried
 * request or a double-click never errors.
 */
export async function DELETE(_request: Request, context: { params: Promise<{ mxeId: string; shareId: string }> }) {
  const { mxeId, shareId } = await context.params;

  const authClient = await createSupabaseServerClient();
  if (!authClient) return NextResponse.json({ error: "Missing Supabase auth configuration." }, { status: 503 });

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const service = createSupabaseServiceClient();
  if (!service) return NextResponse.json({ error: "Missing Supabase service role configuration." }, { status: 503 });

  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) return NextResponse.json({ error: "Vessel not found." }, { status: 404 });

  // Scoped to this vessel's id, not just the share's own id — an owner
  // can't revoke another owner's share even by guessing a shareId, since
  // loadOwnedVessel above already proved ownership of *this* vessel_id.
  const { error } = await service
    .from("vessel_shares")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", shareId)
    .eq("vessel_id", vessel.id)
    .is("revoked_at", null);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
