import { redirect } from "next/navigation";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
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
type Props = {
  /** tier=full: a Basic -> Full upgrade. The account is already active, so wait for the tier instead. */
  searchParams: Promise<{ tier?: string }>;
};

export default async function UpgradeProcessingPage({ searchParams }: Props) {
  const { tier: awaitedTier } = await searchParams;
  const supabase = await requireSupabaseServerClient("app/dashboard/upgrade/processing/page");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/upgrade/processing");
  }

  const service = requireSupabaseServiceClient("app/dashboard/upgrade/processing/page");
  const normalizedEmail = user.email?.trim().toLowerCase();
  type Row = { subscription_status: string | null; subscription_tier: string | null };
  let row: Row | null = null;

  if (normalizedEmail) {
    const { data } = await service
      .from("users")
      .select("subscription_status, subscription_tier")
      .eq("email", normalizedEmail)
      .maybeSingle();
    row = data as Row | null;
  }
  if (!row) {
    const { data } = await service.from("users").select("subscription_status, subscription_tier").eq("id", user.id).maybeSingle();
    row = data as Row | null;
  }

  // A Basic -> Full upgrade starts from an active account, so status alone
  // would redirect before the webhook has written Full.
  const done =
    row?.subscription_status === "active" && (awaitedTier !== "full" || row.subscription_tier === "full");
  if (done) {
    redirect("/dashboard?upgraded=1");
  }

  return <ActivationPoller mode="upgrade" />;
}
