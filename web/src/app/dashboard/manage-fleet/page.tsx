import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { VESSEL_LIMIT, type SubscriptionTier } from "@/lib/tier-config";
import { ManageFleetForm } from "./ManageFleetForm";

/**
 * "Choose which vessels stay active" — the standing reactivation path
 * for the 'locked' dormant cause (dormant identity spec §5/§6), not
 * gated to the 14-day grace window. Reached from the dashboard's
 * overflow banner and from a locked vessel's own dormant banner.
 */
export default async function ManageFleetPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/login?next=/dashboard/manage-fleet");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/manage-fleet");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const normalizedEmail = user.email?.trim().toLowerCase();
  let ownerId = user.id;
  if (normalizedEmail) {
    const { data: ownerByEmailRow } = await service.from("users").select("id").eq("email", normalizedEmail).maybeSingle();
    const ownerByEmail = ownerByEmailRow as { id: string } | null;
    if (ownerByEmail?.id) ownerId = ownerByEmail.id;
  }

  const { data: ownerRow } = await service.from("users").select("subscription_tier").eq("id", ownerId).maybeSingle();
  const tier: SubscriptionTier = (ownerRow as { subscription_tier: string | null } | null)?.subscription_tier === "full" ? "full" : "basic";
  const limit = VESSEL_LIMIT[tier];

  // Everything eligible to be "active" — currently active, or dormant
  // specifically because it's locked-overflow (not lapsed or
  // decommissioned, which aren't choosable here).
  const { data: vesselRows } = await service
    .from("vessels")
    .select("id, mxe_id, vessel_name, make, model, year, photo_url, lifecycle_status, dormant_cause")
    .eq("owner_id", ownerId)
    .eq("qr_status", "active")
    .or("lifecycle_status.eq.active,dormant_cause.eq.locked");

  type Row = {
    id: string;
    mxe_id: string;
    vessel_name: string;
    make: string;
    model: string;
    year: number;
    photo_url: string | null;
    lifecycle_status: string | null;
    dormant_cause: string | null;
  };
  const vessels = (vesselRows ?? []) as Row[];

  if (vessels.length === 0) {
    redirect("/dashboard");
  }

  return (
    <ManageFleetForm
      tierLabel={tier === "full" ? "Full Access" : "Basic"}
      limit={limit}
      vessels={vessels.map((v) => ({
        id: v.id,
        mxeId: v.mxe_id,
        vesselName: v.vessel_name,
        vesselTag: [v.year, v.make, v.model].filter(Boolean).join(" "),
        photoUrl: v.photo_url,
        isActive: v.lifecycle_status === "active",
      }))}
    />
  );
}
