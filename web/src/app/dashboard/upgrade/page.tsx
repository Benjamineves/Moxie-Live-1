import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { UpgradeForm } from "./UpgradeForm";

/**
 * Account-level Full Access upgrade — not scoped to any vessel (build spec
 * §9 item 16). Reached from AccountBillingPanel's "Upgrade to Full
 * Access" link and, optionally, an upsell after a vessel's badge-fee
 * payment. Covers every vessel the account owns, present and future, up
 * to the existing 5-vessel cap.
 */
export default async function UpgradePage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/login?next=/dashboard/upgrade");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/upgrade");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  type OwnerRow = { subscription_tier: string | null; subscription_status: string | null };

  const normalizedEmail = user.email?.trim().toLowerCase();
  let ownerRow: OwnerRow | null = null;

  if (normalizedEmail) {
    const { data } = await service
      .from("users")
      .select("subscription_tier, subscription_status")
      .eq("email", normalizedEmail)
      .maybeSingle();
    ownerRow = data as OwnerRow | null;
  }
  if (!ownerRow) {
    const { data } = await service
      .from("users")
      .select("subscription_tier, subscription_status")
      .eq("id", user.id)
      .maybeSingle();
    ownerRow = data as OwnerRow | null;
  }

  // Nothing left to offer — already on active Full.
  if (ownerRow?.subscription_tier === "full" && ownerRow?.subscription_status === "active") {
    redirect("/dashboard");
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

  return <UpgradeForm publishableKey={publishableKey} />;
}
