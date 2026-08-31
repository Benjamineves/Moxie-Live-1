"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";

export type Tier = "basic" | "full";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Creates (or reuses) the client secret for the selected tier's payment.
 * Basic is a standalone one-time PaymentIntent. Full is a subscription
 * created with payment_behavior='default_incomplete', whose first invoice's
 * PaymentIntent we confirm through the same <PaymentElement> — the standard
 * "subscription with Elements" pattern. Neither path writes qr_status or
 * anything else to the database here; activation only ever happens from the
 * webhook once Stripe confirms the charge (build spec §4).
 */
export async function createIntentForTier(mxeId: string, tier: Tier): Promise<IntentResult> {
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

  const { data: ownerRow } = await service
    .from("users")
    .select("id, email, stripe_customer_id, subscription_tier")
    .eq("id", vessel.owner_id)
    .maybeSingle();
  const owner = ownerRow as
    | { id: string; email: string; stripe_customer_id: string | null; subscription_tier: string | null }
    | null;

  // Active vessels can still reach this action to upgrade Basic -> Full
  // (payment/page.tsx's redirect only skips checkout once there's nothing
  // left to offer: active AND already Full). Basic never has anything to
  // offer an already-active vessel, so it's blocked unconditionally here —
  // independent re-check, not just relying on the client hiding the option
  // (see PaymentForm.tsx). Full is blocked only if truly redundant.
  if (vessel.qr_status === "active") {
    if (tier === "basic") {
      return { error: "This vessel is already active." };
    }
    if (owner?.subscription_tier === "full") {
      return { error: "Already on Full Access." };
    }
  }

  const stripe = getStripe();

  // Shared by both tiers — this block runs once, before the tier branch
  // below, so the fix here covers Basic and Full identically.
  let customerId = owner?.stripe_customer_id ?? null;

  if (customerId) {
    // A stored id doesn't mean Stripe still recognizes it — customers get
    // deleted (in Stripe's dashboard, via the API, or a mode/account
    // change) independent of our own database. Verify before trusting it;
    // a stale id used directly against paymentIntents.create/
    // subscriptions.create throws "No such customer" and crashes checkout.
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (existing.deleted) {
        customerId = null;
      }
    } catch {
      customerId = null;
    }
  }

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

  const metadata = { mxe_id: vessel.mxe_id, vessel_id: vessel.id };

  if (tier === "basic") {
    const priceId = process.env.STRIPE_PRICE_ID_BASIC?.trim();
    if (!priceId) return { error: "Missing STRIPE_PRICE_ID_BASIC." };

    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) return { error: "Basic price has no unit amount configured." };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { ...metadata, payment_type: "setup_fee" },
    });

    if (!paymentIntent.client_secret) return { error: "Stripe did not return a client secret." };
    return { clientSecret: paymentIntent.client_secret };
  }

  const priceId = process.env.STRIPE_PRICE_ID_FULL?.trim();
  if (!priceId) return { error: "Missing STRIPE_PRICE_ID_FULL." };

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [{ price: priceId }],
    payment_behavior: "default_incomplete",
    payment_settings: { save_default_payment_method: "on_subscription" },
    // Invoice.payment_intent was removed from the Stripe API (installed
    // SDK: stripe@22) — expanding it is no longer valid. Invoice.
    // confirmation_secret.client_secret is the current replacement.
    // confirmation_secret was added in the same API wave as invoice.payments
    // (see stripe package CHANGELOG), which is confirmed NOT included by
    // default and needs its own expand — treating confirmation_secret the
    // same way, on the same dotted-path convention the old
    // latest_invoice.payment_intent used, since the installed types don't
    // encode which expand paths are valid (expand is just Array<string>,
    // unchecked) and there's no bundled spec here to confirm against directly.
    expand: ["latest_invoice", "latest_invoice.confirmation_secret"],
    metadata,
  });

  const invoice = subscription.latest_invoice;
  const clientSecret = invoice && typeof invoice !== "string" ? (invoice.confirmation_secret?.client_secret ?? null) : null;

  if (!clientSecret) {
    // Hard-fail loudly server-side, not just as a UI string a click-through
    // could miss — this must never render an empty payment form silently.
    console.error(
      `[payment] Full-tier subscription ${subscription.id} (mxe=${mxeId}) returned no confirmation_secret.client_secret. ` +
        `latest_invoice=${typeof invoice === "string" ? invoice : (invoice?.id ?? "null")}, ` +
        `has_confirmation_secret=${typeof invoice !== "string" && !!invoice?.confirmation_secret}`,
    );
    return { error: "Stripe did not return a payment client secret for the subscription." };
  }

  // subscriptions.create()'s own `metadata` only lands on the Subscription
  // object — confirmed via the installed SubscriptionCreateParams types,
  // there's no invoice/payment_intent metadata pass-through param (unlike
  // Checkout Sessions' payment_intent_data.metadata). Invoice.parent.
  // subscription_details.metadata snapshots it onto the invoice, but that
  // doesn't reach the PaymentIntent itself, which is what actually shows up
  // in Stripe's payment/balance export. So: tag that PaymentIntent directly.
  // Its id is the part of client_secret before "_secret_" — Stripe's
  // long-established client_secret format, not something the local types
  // encode but a stable, documented convention independent of this SDK
  // version's field churn.
  const paymentIntentId = clientSecret.split("_secret_")[0];
  if (paymentIntentId) {
    try {
      await stripe.paymentIntents.update(paymentIntentId, {
        metadata: { ...metadata, payment_type: "subscription" },
      });
    } catch (err) {
      // Don't fail checkout over a metadata tag — log it and let the
      // payment proceed; the webhook still activates correctly via
      // subscription.metadata regardless of whether this tag lands.
      console.error(`[payment] Failed to tag PaymentIntent ${paymentIntentId} with metadata:`, err);
    }
  }

  return { clientSecret };
}
