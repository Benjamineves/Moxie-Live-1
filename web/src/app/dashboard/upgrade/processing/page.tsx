import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ActivationPoller } from "@/components/ActivationPoller";

/**
 * Landing spot after Stripe confirms the plan subscription's first invoice
 * client-side — Basic or Full. subscription_status only ever flips via the
 * webhook (build spec §4), which can lag the redirect by a second or two —
 * this page waits it out, same pattern as the badge-fee processing page,
 * just account-scoped instead of vessel-scoped (build spec §9 item 16).
 * Checks subscription_status rather than subscription_tier==='full' so a
 * Basic subscriber's checkout resolves here too, not just Full's.
 */
export default async function UpgradeProcessingPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/login?next=/dashboard/upgrade/processing");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/upgrade/processing");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const normalizedEmail = user.email?.trim().toLowerCase();
  let subscriptionStatus: string | null = null;

  if (normalizedEmail) {
    const { data } = await service
      .from("users")
      .select("subscription_status")
      .eq("email", normalizedEmail)
      .maybeSingle();
    subscriptionStatus = (data as { subscription_status: string | null } | null)?.subscription_status ?? null;
  }
  if (subscriptionStatus === null) {
    const { data } = await service.from("users").select("subscription_status").eq("id", user.id).maybeSingle();
    subscriptionStatus = (data as { subscription_status: string | null } | null)?.subscription_status ?? null;
  }

  if (subscriptionStatus === "active") {
    redirect("/dashboard?upgraded=1");
  }

  return <ActivationPoller mode="upgrade" />;
}
