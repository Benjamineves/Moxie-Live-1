import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ActivationPoller } from "@/components/ActivationPoller";

type Props = {
  params: Promise<{ mxeId: string }>;
};

/**
 * Landing spot after Stripe confirms the badge-fee payment client-side.
 * qr_status only ever flips via the webhook (build spec §4), which can lag
 * the redirect by a second or two — this page waits it out instead of the
 * QR/profile page having to special-case "just paid" vs. "never paid."
 *
 * This page is badge-fee-only now — the Basic/Full upgrade path that used
 * to also land here (via ?upgrade=1) moved to /dashboard/upgrade/processing
 * alongside the rest of the account-level subscription flow (build spec §9
 * item 16).
 */
export default async function PaymentProcessingPage({ params }: Props) {
  const { mxeId } = await params;

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

  if (vessel.qr_status === "active") {
    redirect(`/dashboard/${encodeURIComponent(vessel.mxe_id)}/qr`);
  }

  return <ActivationPoller mxeId={vessel.mxe_id} />;
}
