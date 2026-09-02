import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { UpgradeForm } from "./UpgradeForm";
import { UpgradeToFullForm } from "./UpgradeToFullForm";

/**
 * Account-level plan picker, or Basic → Full upgrade confirm screen —
 * not scoped to any vessel (build spec §9 item 16, generalized for the
 * tier structure build). Reached from AccountBillingPanel:
 *  - No active/past_due subscription at all → the two-plan picker
 *    (UpgradeForm), same as picking a plan for the first time.
 *  - Active/past_due on Basic → the upgrade confirm screen
 *    (UpgradeToFullForm) — a real, contextual "upgrade to Full" path
 *    that didn't exist before (Manage Billing/the Stripe Portal has no
 *    concept of our tiers, so it couldn't offer this).
 *  - Active/past_due on Full already → nothing to do, back to /dashboard.
 * Switching FROM Full back down to Basic still isn't handled here —
 * that stays a Manage Billing / Stripe Portal action, a separate,
 * deliberate decision from "upgrade."
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

  type OwnerRow = { subscription_status: string | null; subscription_tier: string | null };

  const normalizedEmail = user.email?.trim().toLowerCase();
  let ownerRow: OwnerRow | null = null;

  if (normalizedEmail) {
    const { data } = await service
      .from("users")
      .select("subscription_status, subscription_tier")
      .eq("email", normalizedEmail)
      .maybeSingle();
    ownerRow = data as OwnerRow | null;
  }
  if (!ownerRow) {
    const { data } = await service
      .from("users")
      .select("subscription_status, subscription_tier")
      .eq("id", user.id)
      .maybeSingle();
    ownerRow = data as OwnerRow | null;
  }

  const hasSubscription = ownerRow?.subscription_status === "active" || ownerRow?.subscription_status === "past_due";

  // Already on Full — nothing left to do here. Downgrading is a Manage
  // Billing / Stripe Portal action, not this page.
  if (hasSubscription && ownerRow?.subscription_tier === "full") {
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

  if (hasSubscription && ownerRow?.subscription_tier === "basic") {
    return <UpgradeToFullForm publishableKey={publishableKey} />;
  }

  return <UpgradeForm publishableKey={publishableKey} />;
}
