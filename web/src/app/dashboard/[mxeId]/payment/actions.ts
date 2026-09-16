"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import { isAdminEmail } from "@/lib/admin-verify";
import { countActiveVessels, evaluateVesselCap } from "@/lib/vessel-cap";
import { IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES } from "@/lib/stripe/payment-methods";
import { releaseAbandonedSubscription } from "@/lib/stripe/abandoned-subscription";
import type { SubscriptionTier } from "@/lib/tier-config";

/**
 * `code: "VESSEL_CAP_REACHED"` means the cap refused this checkout before
 * anything was sent to Stripe — no intent, no subscription, no charge.
 * `tier` is the plan the refusal was measured against, so the form can
 * offer the right way forward (Full Access, or the fleet).
 */
type IntentResult =
  | { clientSecret: string }
  | { error: string; code?: "VESSEL_CAP_REACHED"; tier?: SubscriptionTier };

/**
 * WHY THESE RUN AT THE PAY CLICK, NOT WHEN THE PAGE LOADS
 *
 * Both actions below used to be called from a useEffect as the payment
 * page mounted, and neither checked the vessel cap. A cap check added at
 * that moment would not have closed anything: an owner can open the
 * payment page for five unpaid vessels before paying for any of them, and
 * all five checks would see the same one active vessel. That is the
 * original bypass, one step later, through the ordinary flow.
 *
 * So Elements now mounts in deferred mode (amount and currency, no
 * intent), and these are called from the form's submit handler, after
 * elements.submit() and the shipping address, immediately before
 * stripe.confirmPayment. The cap is measured about a second before the
 * card is charged, against the vessels that are actually active by then.
 *
 * This is still not the enforcement — see lib/vessel-cap.ts. Two submits
 * in the same second both pass. What catches that is
 * reconcile_vessel_overflow in the webhook, after activation.
 */

/**
 * Creates the PaymentIntent for a vessel's one-time badge fee, at the Pay
 * click — refusing first if the account's plan has no room for another
 * active vessel
 * — the physical badge's real per-unit cost, charged for every vessel
 * regardless of the account's subscription tier. Full Access is a
 * separate, account-level subscription now (build spec §9 item 16 —
 * confirmed live that the old per-vessel version created a duplicate
 * Stripe subscription for every vessel an owner upgraded, instead of one
 * plan covering the account); see dashboard/upgrade/actions.ts for that.
 * qr_status only ever flips from the webhook once Stripe confirms the
 * charge, never from here.
 */
export async function createBadgeFeeIntent(mxeId: string): Promise<IntentResult> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/app/dashboard/[mxeId]/payment/actions");
  const ownerIds = [user.id];
  const normalizedEmail = user.email?.trim().toLowerCase();
  if (normalizedEmail) {
    const { data: ownerByEmailRow } = await service
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const ownerByEmail = ownerByEmailRow as { id: string } | null;
    if (ownerByEmail?.id && ownerByEmail.id !== user.id) ownerIds.push(ownerByEmail.id);
  }

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, mxe_id, owner_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  const vessel = vesselRow as { id: string; mxe_id: string; owner_id: string; qr_status: string | null } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }

  if (vessel.qr_status === "active") {
    return { error: "This vessel is already active." };
  }

  const { data: ownerRow } = await service
    .from("users")
    .select("id, email, stripe_customer_id, subscription_tier")
    .eq("id", vessel.owner_id)
    .maybeSingle();
  const owner = ownerRow as
    | { id: string; email: string; stripe_customer_id: string | null; subscription_tier: string | null }
    | null;

  // The cap, before a single Stripe call. Measured against the vessel's
  // owner_id — the id every SQL cap check and reconcile_vessel_overflow
  // key on — not the session user, which can differ.
  const tier: SubscriptionTier = owner?.subscription_tier === "full" ? "full" : "basic";
  const active = await countActiveVessels(service, vessel.owner_id);
  if ("error" in active) {
    // Fail closed. An unreadable count is not evidence of room.
    return { error: `Couldn't check your plan's vessel limit: ${active.error}` };
  }
  const cap = evaluateVesselCap({ activeCount: active.count, tier, capExempt: isAdminEmail(owner?.email) });
  if (!cap.allowed) {
    return { error: cap.message, code: "VESSEL_CAP_REACHED", tier };
  }

  const stripe = getStripe();

  let customerId = owner?.stripe_customer_id ?? null;

  if (customerId) {
    // A stored id doesn't mean Stripe still recognizes it — customers get
    // deleted (in Stripe's dashboard, via the API, or a mode/account
    // change) independent of our own database. Verify before trusting it;
    // a stale id used directly against paymentIntents.create throws "No
    // such customer" and crashes checkout.
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (existing.deleted) {
        customerId = null;
      }
    } catch {
      customerId = null;
    }
  }

  // Everything past this point talks to Stripe with real inputs (a price
  // ID from env, a customer id, amounts) that can be wrong in ways that
  // only surface at request time — a stale/wrong/wrong-mode price ID, a
  // restricted account, etc. Catching here and returning a clean
  // {error} — rather than letting the exception propagate up through the
  // Server Action boundary — matters because Next.js redacts a *thrown*
  // server action error down to a generic message in production; a
  // returned {error} string reaches the client's UI verbatim instead.
  try {
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner?.email ?? user.email ?? undefined,
        metadata: { user_id: owner?.id ?? user.id },
      });
      customerId = customer.id;
      if (owner?.id) {
        await service.from("users").update({ stripe_customer_id: customerId }).eq("id", owner.id);
      }
    }

    const priceId = process.env.STRIPE_PRICE_ID_BADGE?.trim();
    if (!priceId) return { error: "Missing STRIPE_PRICE_ID_BADGE." };

    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) return { error: "Badge price has no unit amount configured." };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency,
      customer: customerId,
      // Immediate-settlement methods only, named explicitly — never
      // automatic_payment_methods, which follows the Stripe dashboard and
      // offered bank debit: while it settled the vessel stayed unpaid and
      // the page offered checkout again. See lib/stripe/payment-methods.ts.
      payment_method_types: [...IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES],
      metadata: { mxe_id: vessel.mxe_id, vessel_id: vessel.id, payment_type: "badge_fee" },
    });

    if (!paymentIntent.client_secret) return { error: "Stripe did not return a client secret." };
    return { clientSecret: paymentIntent.client_secret };
  } catch (err) {
    console.error(`[payment] createBadgeFeeIntent failed for ${vessel.mxe_id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start checkout. Please try again." };
  }
}

/**
 * The bundled first-vessel checkout: plan choice + badge fee, one invoice,
 * one <PaymentElement> confirmation. Only ever used when the owner has no
 * active subscription yet (page.tsx branches on subscription_status !==
 * 'active') — every vessel after the first is badge-fee-only via
 * createBadgeFeeIntent above, since the account's plan already covers it.
 *
 * Mechanics: add_invoice_items attaches the one-time badge Price to the
 * subscription's FIRST invoice only — it never recurs on renewal, so this
 * produces exactly one Stripe Invoice with two line items (the recurring
 * plan + the one-time badge) and exactly one PaymentIntent behind it, same
 * as any other subscription's default_incomplete first invoice. No second
 * confirmation step needed.
 */
export async function createSignupBundleIntent(mxeId: string, tier: SubscriptionTier): Promise<IntentResult> {
  // A server action's arguments come from the client. The cap is measured
  // against this tier, so an unrecognised value must not fall through to
  // anything — it used to be silently treated as Basic.
  if (tier !== "basic" && tier !== "full") {
    return { error: "Choose a plan." };
  }

  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/app/dashboard/[mxeId]/payment/actions");
  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, mxe_id, owner_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  const vessel = vesselRow as { id: string; mxe_id: string; owner_id: string; qr_status: string | null } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }
  if (vessel.qr_status === "active") {
    return { error: "This vessel is already active." };
  }

  const { data: ownerRow } = await service
    .from("users")
    .select("id, email, stripe_customer_id, subscription_status, stripe_subscription_id")
    .eq("id", vessel.owner_id)
    .maybeSingle();
  const owner = ownerRow as
    | {
        id: string;
        email: string;
        stripe_customer_id: string | null;
        subscription_status: string | null;
        stripe_subscription_id: string | null;
      }
    | null;
  if (!owner) return { error: "Owner account not found." };

  if (owner.subscription_status === "active") {
    return { error: "Your account already has an active plan — this vessel only needs its badge fee. Refresh the page." };
  }

  // The cap, against the plan being CHOSEN — this account has no plan yet,
  // so the stored subscription_tier describes nothing. It is not always
  // zero vessels: a buyer who received boats by transfer can arrive here
  // already holding some. Checked before any Stripe call, including the
  // cancellation of an abandoned incomplete subscription below, so a
  // refusal has no side effects in Stripe at all.
  const active = await countActiveVessels(service, vessel.owner_id);
  if ("error" in active) {
    return { error: `Couldn't check the plan's vessel limit: ${active.error}` };
  }
  const cap = evaluateVesselCap({ activeCount: active.count, tier, capExempt: isAdminEmail(owner.email) });
  if (!cap.allowed) {
    return { error: cap.message, code: "VESSEL_CAP_REACHED", tier };
  }

  const stripe = getStripe();

  let customerId = owner.stripe_customer_id;
  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (existing.deleted) customerId = null;
    } catch {
      customerId = null;
    }
  }

  try {
    // A subscription left on file by an earlier Pay click that didn't
    // finish is cancelled and cleared; a live one refuses. Shared with the
    // plan picker on /dashboard/upgrade — see
    // lib/stripe/abandoned-subscription.ts.
    const blocked = await releaseAbandonedSubscription(stripe, service, owner);
    if (blocked) return blocked;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner.email ?? user.email ?? undefined,
        metadata: { user_id: owner.id },
      });
      customerId = customer.id;
      await service.from("users").update({ stripe_customer_id: customerId }).eq("id", owner.id);
    }

    const planEnvVar = tier === "full" ? "STRIPE_PRICE_ID_FULL" : "STRIPE_PRICE_ID_BASIC_SUBSCRIPTION";
    const planPriceId = process.env[planEnvVar]?.trim();
    if (!planPriceId) return { error: `Missing ${planEnvVar}.` };

    const badgePriceId = process.env.STRIPE_PRICE_ID_BADGE?.trim();
    if (!badgePriceId) return { error: "Missing STRIPE_PRICE_ID_BADGE." };

    const badgePrice = await stripe.prices.retrieve(badgePriceId);
    if (!badgePrice.unit_amount) return { error: "Badge price has no unit amount configured." };

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: planPriceId }],
      add_invoice_items: [{ price: badgePriceId }],
      payment_behavior: "default_incomplete",
      // The subscription's invoices — including the first, which carries
      // the badge fee — accept immediate-settlement methods only. While a
      // bank debit settled, the subscription stayed incomplete and a second
      // Pay click cancelled it to start another. This also applies to
      // renewals, which charge the saved card. See
      // lib/stripe/payment-methods.ts.
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: [...IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES],
      },
      expand: ["latest_invoice", "latest_invoice.confirmation_secret"],
      metadata: { owner_id: owner.id, tier, vessel_id: vessel.id, mxe_id: vessel.mxe_id },
    });

    const invoice = subscription.latest_invoice;
    const clientSecret =
      invoice && typeof invoice !== "string" ? (invoice.confirmation_secret?.client_secret ?? null) : null;

    if (!clientSecret) {
      console.error(
        `[payment] signup-bundle subscription ${subscription.id} (owner=${owner.id}, vessel=${vessel.mxe_id}) returned no confirmation_secret.client_secret. ` +
          `latest_invoice=${typeof invoice === "string" ? invoice : (invoice?.id ?? "null")}.`,
      );
      return { error: "Stripe did not return a payment client secret for the subscription." };
    }

    // Set immediately, ahead of the webhook, so the next Pay click finds
    // it — see lib/stripe/abandoned-subscription.ts.
    await service.from("users").update({ stripe_subscription_id: subscription.id }).eq("id", owner.id);

    // The tag is REQUIRED, not best-effort. It used to be wrapped in a
    // try/catch that only logged, which let the owner pay an untagged
    // intent. Two things depend on these fields and both fail silently
    // without them:
    //  - the webhook routes on metadata.payment_type, so an untagged
    //    payment is ignored entirely: charged, never activated;
    //  - the Stripe check before deleting an unpaid vessel finds payments
    //    by metadata.mxe_id, so an untagged payment is invisible to it and
    //    the vessel it paid for could be deleted.
    // So if the tag cannot be written, the client secret is withheld and
    // nothing can be charged. The incomplete subscription left behind is
    // cancelled by the next Pay click, same as any abandoned one.
    const paymentIntentId = clientSecret.split("_secret_")[0];
    if (!paymentIntentId) {
      return { error: "Stripe returned a payment secret in an unexpected format. Nothing has been charged." };
    }
    try {
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: {
          mxe_id: vessel.mxe_id,
          vessel_id: vessel.id,
          owner_id: owner.id,
          payment_type: "signup_bundle",
          badge_fee_amount_cents: String(badgePrice.unit_amount),
        },
      });
    } catch (err) {
      console.error(`[payment] Failed to tag PaymentIntent ${paymentIntentId} with metadata — withholding the client secret:`, err);
      return { error: "Couldn't prepare the payment. Nothing has been charged — please try again." };
    }

    return { clientSecret };
  } catch (err) {
    console.error(`[payment] createSignupBundleIntent failed for ${vessel.mxe_id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start checkout. Please try again." };
  }
}
