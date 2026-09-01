"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";

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
}
