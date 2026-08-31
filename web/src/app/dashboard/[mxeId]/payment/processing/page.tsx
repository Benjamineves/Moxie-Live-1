import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ActivationPoller } from "./ActivationPoller";

type Props = {
  params: Promise<{ mxeId: string }>;
  searchParams: Promise<{ upgrade?: string }>;
};

/**
 * Landing spot after Stripe confirms payment client-side. qr_status/
 * subscription_tier only ever flip via the webhook (build spec §4), which
 * can lag the redirect by a second or two — this page waits it out instead
 * of the QR/profile page having to special-case "just paid" vs. "never
 * paid."
 *
 * An upgrade (Basic -> Full on an already-active vessel) never touches
 * qr_status — it's already 'active' going in — so the first-activation
 * check below would otherwise fire immediately and send an upgrading owner
 * to the QR reveal page for a sticker they already have. `?upgrade=1`
 * (set by PaymentForm when isUpgrade is true) switches this to watch
 * subscription_tier instead and land on the profile with a confirmation.
 */
export default async function PaymentProcessingPage({ params, searchParams }: Props) {
  const { mxeId } = await params;
  const sp = await searchParams;
  const isUpgrade = sp.upgrade === "1";

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/payment/processing`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/payment/processing`);
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
    .select("mxe_id, owner_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  const vessel = vesselRow as { mxe_id: string; owner_id: string; qr_status: string | null } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    redirect("/dashboard");
  }

  if (isUpgrade) {
    const { data: ownerRow } = await service
      .from("users")
      .select("subscription_tier")
      .eq("id", vessel.owner_id)
      .maybeSingle();
    const subscriptionTier = (ownerRow as { subscription_tier: string | null } | null)?.subscription_tier;

    if (subscriptionTier === "full") {
      redirect(`/${encodeURIComponent(vessel.mxe_id)}?role=owner&upgraded=1`);
    }

    return <ActivationPoller mxeId={vessel.mxe_id} mode="upgrade" />;
  }

  if (vessel.qr_status === "active") {
    redirect(`/dashboard/${encodeURIComponent(vessel.mxe_id)}/qr`);
  }

  return <ActivationPoller mxeId={vessel.mxe_id} />;
}
