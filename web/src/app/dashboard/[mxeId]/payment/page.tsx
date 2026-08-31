import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { PaymentForm } from "./PaymentForm";

type Props = {
  params: Promise<{ mxeId: string }>;
};

export default async function VesselPaymentPage({ params }: Props) {
  const { mxeId } = await params;

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/payment`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/payment`);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const ownerIds = [user.id];
  const normalizedEmail = user.email?.trim().toLowerCase();
  if (normalizedEmail) {
    const { data: ownerByEmailRow } = await service
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const ownerByEmail = ownerByEmailRow as { id: string } | null;
    if (ownerByEmail?.id && ownerByEmail.id !== user.id) {
      ownerIds.push(ownerByEmail.id);
    }
  }

  const { data: vesselRow } = await service
    .from("vessels")
    .select("mxe_id, vessel_name, make, model, year, owner_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  const vessel = vesselRow as
    | { mxe_id: string; vessel_name: string; make: string; model: string; year: number; owner_id: string; qr_status: string | null }
    | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    redirect("/dashboard");
  }

  // Already active — but a Basic customer can still land here to upgrade
  // to Full (the Account & Billing panel's CTA does exactly this). Only
  // skip straight to /qr once there's genuinely nothing left to offer:
  // active AND already on Full. An active-but-Basic vessel falls through
  // to the tier picker below unchanged.
  if (vessel.qr_status === "active") {
    const { data: ownerRow } = await service
      .from("users")
      .select("subscription_tier")
      .eq("id", vessel.owner_id)
      .maybeSingle();
    const subscriptionTier = (ownerRow as { subscription_tier: string | null } | null)?.subscription_tier;

    if (subscriptionTier === "full") {
      redirect(`/dashboard/${encodeURIComponent(vessel.mxe_id)}/qr`);
    }
  }

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    return (
      <div className="min-h-screen bg-[var(--cream)] px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Payments not configured
        </h1>
        <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          Add <code className="rounded bg-[var(--cream2)] px-1 text-xs">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to
          the server environment.
        </p>
      </div>
    );
  }

  // If we get here without redirecting above, an active vessel can only be
  // active-and-Basic (active-and-Full already redirected) — i.e. an upgrade.
  const isUpgrade = vessel.qr_status === "active";

  return (
    <PaymentForm
      mxeId={vessel.mxe_id}
      vesselName={vessel.vessel_name}
      vesselTag={[vessel.year, vessel.make, vessel.model].filter(Boolean).join(" ")}
      publishableKey={publishableKey}
      isUpgrade={isUpgrade}
    />
  );
}
