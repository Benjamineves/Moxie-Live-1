import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { UpgradeForm } from "./UpgradeForm";
import { UpgradeToFullForm } from "./UpgradeToFullForm";
import { PastDueBillingPrompt } from "./PastDueBillingPrompt";
import { getPlanAmounts } from "@/lib/stripe/checkout-amounts";
import { getStripe } from "@/lib/stripe/server";
import { quoteTierUpgrade } from "@/lib/stripe/tier-upgrade";

/** The Basic -> Full quote as of this moment. Reads only. */
async function quoteUpgradeAsOfNow(subscriptionId: string) {
  const now = Math.floor(Date.now() / 1000);
  return quoteTierUpgrade(getStripe(), { subscriptionId, prorationDate: now, now });
}

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
 *  - Active on Basic → the upgrade confirm screen (UpgradeToFullForm), with
 *    the prorated total quoted on load (a read) —
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

  type OwnerRow = { subscription_status: string | null; subscription_tier: string | null; stripe_subscription_id: string | null };

  const normalizedEmail = user.email?.trim().toLowerCase();
  let ownerRow: OwnerRow | null = null;

  if (normalizedEmail) {
    const { data } = await service
      .from("users")
      .select("subscription_status, subscription_tier, stripe_subscription_id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    ownerRow = data as OwnerRow | null;
  }
  if (!ownerRow) {
    const { data } = await service
      .from("users")
      .select("subscription_status, subscription_tier, stripe_subscription_id")
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

  const unavailable = (message: string) => (
    <div className="min-h-screen bg-[var(--cream)] px-6 py-16">
      <h1 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
        Checkout is unavailable right now
      </h1>
      <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">{message}</p>
    </div>
  );

  if (isActive && ownerRow?.subscription_tier === "basic") {
    // The prorated total, quoted as of now. Reads only (subscriptions.retrieve,
    // invoices.createPreview) — loading this page changes nothing in Stripe.
    // The Pay click re-quotes with this same proration_date and must match.
    if (!ownerRow.stripe_subscription_id) {
      return unavailable("We couldn't find the subscription on your account, so nothing can be charged.");
    }
    let quote;
    try {
      quote = await quoteUpgradeAsOfNow(ownerRow.stripe_subscription_id);
    } catch (err) {
      console.error("[upgrade] Could not quote the Basic -> Full upgrade:", err);
      return unavailable("We couldn't calculate your upgrade total, so nothing can be charged. Try again in a moment.");
    }
    if ("error" in quote) return unavailable(quote.error);
    return (
      <UpgradeToFullForm
        publishableKey={publishableKey}
        amountCents={quote.amountCents}
        currency={quote.currency}
        prorationDate={quote.prorationDate}
      />
    );
  }

  // Elements mounts in deferred mode, before any subscription exists, so
  // it needs the real plan amounts up front. Reads the two Stripe Prices;
  // nothing is created by loading this page.
  let amounts;
  try {
    amounts = await getPlanAmounts();
  } catch (err) {
    console.error("[upgrade] Could not read plan amounts:", err);
    return unavailable("We couldn't load the plan prices, so nothing can be charged. Try again in a moment.");
  }

  return <UpgradeForm publishableKey={publishableKey} amounts={amounts} />;
}
