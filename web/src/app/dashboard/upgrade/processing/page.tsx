import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { ActivationPoller } from "@/components/ActivationPoller";

/**
 * Landing spot after Stripe confirms the Full Access subscription's first
 * invoice client-side. subscription_tier only ever flips via the webhook
 * (build spec §4), which can lag the redirect by a second or two — this
 * page waits it out, same pattern as the badge-fee processing page, just
 * account-scoped instead of vessel-scoped (build spec §9 item 16).
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
  let subscriptionTier: string | null = null;

  if (normalizedEmail) {
    const { data } = await service
      .from("users")
      .select("subscription_tier")
      .eq("email", normalizedEmail)
      .maybeSingle();
    subscriptionTier = (data as { subscription_tier: string | null } | null)?.subscription_tier ?? null;
  }
  if (subscriptionTier === null) {
    const { data } = await service.from("users").select("subscription_tier").eq("id", user.id).maybeSingle();
    subscriptionTier = (data as { subscription_tier: string | null } | null)?.subscription_tier ?? null;
  }

  if (subscriptionTier === "full") {
    redirect("/dashboard?upgraded=1");
  }

  return <ActivationPoller mode="upgrade" />;
}
