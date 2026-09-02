"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import type { SubscriptionTier } from "@/lib/tier-config";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Creates (or reuses) the client secret for a vessel's one-time badge fee
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

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

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
    .select("id, email, stripe_customer_id")
    .eq("id", vessel.owner_id)
    .maybeSingle();
  const owner = ownerRow as { id: string; email: string; stripe_customer_id: string | null } | null;

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
      automatic_payment_methods: { enabled: true },
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
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

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
    // stripe_subscription_id is set immediately after creating a
    // subscription (below), before payment even completes — so picking
    // Full and then changing to Basic before paying leaves a real but
    // still-unpaid ("incomplete") subscription behind. That's not the
    // same case the guard below exists for (two tabs racing to create a
    // subscription for the SAME pick): here, cancel the abandoned
    // incomplete one and let this request proceed with the new tier,
    // rather than treating a plan change as a collision. Only a
    // genuinely active/paid subscription (or one still mid-flight from a
    // concurrent request) blocks outright.
    if (owner.stripe_subscription_id) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(owner.stripe_subscription_id);
        if (existingSub.status === "incomplete") {
          await stripe.subscriptions.cancel(owner.stripe_subscription_id).catch(() => {});
          await service.from("users").update({ stripe_subscription_id: null }).eq("id", owner.id);
        } else if (existingSub.status === "incomplete_expired") {
          // Stripe already auto-expired it (23h with no payment) — nothing
          // to cancel, just clear the stale id.
          await service.from("users").update({ stripe_subscription_id: null }).eq("id", owner.id);
        } else {
          return { error: "A subscription is already being set up for this account. Refresh the page and try again." };
        }
      } catch {
        // Retrieval failed — id is stale (deleted, wrong Stripe mode,
        // etc.). Clear it and proceed rather than blocking forever on a
        // subscription that no longer exists.
        await service.from("users").update({ stripe_subscription_id: null }).eq("id", owner.id);
      }
    }

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
      payment_settings: { save_default_payment_method: "on_subscription" },
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

    // Set immediately, ahead of the webhook — see the race-guard comment
    // above for why this can't wait for invoice.paid.
    await service.from("users").update({ stripe_subscription_id: subscription.id }).eq("id", owner.id);

    const paymentIntentId = clientSecret.split("_secret_")[0];
    if (paymentIntentId) {
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
        console.error(`[payment] Failed to tag PaymentIntent ${paymentIntentId} with metadata:`, err);
      }
    }

    return { clientSecret };
  } catch (err) {
    console.error(`[payment] createSignupBundleIntent failed for ${vessel.mxe_id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start checkout. Please try again." };
  }
}
