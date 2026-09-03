import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { UpgradeForm } from "./UpgradeForm";
import { UpgradeToFullForm } from "./UpgradeToFullForm";
import { PastDueBillingPrompt } from "./PastDueBillingPrompt";

/**
 * Account-level plan picker, or Basic → Full upgrade confirm screen —
 * not scoped to any vessel (build spec §9 item 16, generalized for the
 * tier structure build). Reached from AccountBillingPanel and from a
 * dormant vessel's "Choose a plan" banner:
 *  - past_due (any tier) → PastDueBillingPrompt. This is a real
 *    subscription that's just delinquent, not "pick a new plan" — the
 *    fix is updating the payment method via the Billing Portal. Checked
 *    FIRST, before the tier branches below: a past_due Full account used
 *    to fall into "already on Full, nothing to do" and bounce straight
 *    back to /dashboard with no way to actually fix the payment — found
 *    live testing the dormant-vessel "Choose a plan" link.
 *  - Active, already Full → nothing to do, back to /dashboard.
 *  - Active on Basic → the upgrade confirm screen (UpgradeToFullForm) —
 *    a real, contextual "upgrade to Full" path that didn't exist before
 *    (Manage Billing/the Stripe Portal has no concept of our tiers, so
 *    it couldn't offer this).
 *  - Anything else (canceled/none/null) → the two-plan picker
 *    (UpgradeForm), same as picking a plan for the first time.
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

  // A delinquent subscription needs its payment method fixed, not a new
  // plan pick — checked before the tier branches below regardless of
  // which tier it's delinquent on.
  if (ownerRow?.subscription_status === "past_due") {
    return <PastDueBillingPrompt />;
  }

  const isActive = ownerRow?.subscription_status === "active";

  // Already on active Full — nothing left to do here. Downgrading is a
  // Manage Billing / Stripe Portal action, not this page.
  if (isActive && ownerRow?.subscription_tier === "full") {
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

  if (isActive && ownerRow?.subscription_tier === "basic") {
    return <UpgradeToFullForm publishableKey={publishableKey} />;
  }

  return <UpgradeForm publishableKey={publishableKey} />;
}
