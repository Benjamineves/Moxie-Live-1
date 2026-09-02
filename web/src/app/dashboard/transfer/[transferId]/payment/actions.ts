"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds } from "@/lib/vessel-ownership";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Transfer fee — one-time, charged to the SELLER, on-session, only once
 * the buyer has already accepted (status='awaiting_payment'). Reuses
 * the exact badge-fee/Full-upgrade checkout pattern deliberately
 * (payment-failure option (c), chosen over an off-session charge):
 * no new payment code path, no saved-card requirement, same
 * already-fixed retry-on-failure UI.
 */
export async function createTransferFeeIntent(transferId: string): Promise<IntentResult> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, vessel_id, mxe_id, seller_id, status")
    .eq("id", transferId)
    .maybeSingle();
  const transfer = transferRow as
    | { id: string; vessel_id: string; mxe_id: string; seller_id: string; status: string }
    | null;

  if (!transfer || !ownerIds.includes(transfer.seller_id)) {
    return { error: "Transfer not found." };
  }
  if (transfer.status !== "awaiting_payment") {
    return { error: `This transfer isn't awaiting payment (status: ${transfer.status}).` };
  }

  const { data: ownerRow } = await service
    .from("users")
    .select("id, email, stripe_customer_id")
    .eq("id", transfer.seller_id)
    .maybeSingle();
  const owner = ownerRow as { id: string; email: string; stripe_customer_id: string | null } | null;

  const stripe = getStripe();

  let customerId = owner?.stripe_customer_id ?? null;
  if (customerId) {
    try {
      const existing = await stripe.customers.retrieve(customerId);
      if (existing.deleted) customerId = null;
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

  try {
    const priceId = process.env.STRIPE_PRICE_ID_TRANSFER?.trim();
    if (!priceId) return { error: "Missing STRIPE_PRICE_ID_TRANSFER." };

    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) return { error: "Transfer fee price has no unit amount configured." };

    const paymentIntent = await stripe.paymentIntents.create({
      amount: price.unit_amount,
      currency: price.currency,
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { transfer_id: transfer.id, vessel_id: transfer.vessel_id, mxe_id: transfer.mxe_id, payment_type: "transfer_fee" },
    });

    if (!paymentIntent.client_secret) return { error: "Stripe did not return a client secret." };

    await service
      .from("ownership_transfers")
      .update({ transfer_fee_amount_cents: price.unit_amount })
      .eq("id", transfer.id);

    return { clientSecret: paymentIntent.client_secret };
  } catch (err) {
    console.error(`[transfer-payment] createTransferFeeIntent failed for transfer ${transfer.id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start checkout. Please try again." };
  }
}
