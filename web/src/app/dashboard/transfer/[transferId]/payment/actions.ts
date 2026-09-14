"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import type { SubscriptionTier } from "@/lib/tier-config";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Transfer fee — one-time, charged to the SELLER, on-session, only once
 * the buyer has already accepted (status='awaiting_payment'). Reuses
 * the exact badge-fee checkout pattern deliberately (payment-failure
 * option (c), chosen over an off-session charge): no new payment code
 * path, no saved-card requirement.
 *
 * CALLED AT THE PAY CLICK, NOT WHEN THE PAGE LOADS.
 *
 * This used to run from a useEffect as the payment page mounted, and the
 * page carries a "Cancel this transfer" button. A seller could load the
 * page — creating a live intent — cancel the transfer, and still pay. The
 * webhook then fails on every delivery (complete_ownership_transfer
 * refuses a cancelled transfer), because no retry can make a cancelled
 * transfer payable: the seller has been charged for nothing and needs a
 * manual refund.
 *
 * Now Elements mounts in deferred mode and this runs from the submit
 * handler immediately before stripe.confirmPayment, so the status check
 * below is a moment old when the card is charged, and the form disables
 * the cancel button while a payment is in flight. See the page's note on
 * the window this does NOT close: payment methods that settle days later.
 *
 * `expectedAmountCents` is the fee the page loaded with and the seller was
 * shown. The fee follows the seller's tier, which can change in between;
 * if it has, this refuses instead of charging a different figure. A client
 * can only make that comparison fail, never change what is charged.
 */
export async function createTransferFeeIntent(transferId: string, expectedAmountCents: number): Promise<IntentResult> {
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
  // Before any Stripe call, including the customer creation below, so a
  // transfer cancelled after the page loaded creates nothing in Stripe.
  if (transfer.status !== "awaiting_payment") {
    return {
      error:
        transfer.status === "canceled"
          ? "This transfer has been cancelled, so there is nothing to pay. Nothing has been charged."
          : `This transfer isn't awaiting payment (status: ${transfer.status}). Nothing has been charged.`,
    };
  }

  const { data: ownerRow } = await service
    .from("users")
    .select("id, email, stripe_customer_id, subscription_tier")
    .eq("id", transfer.seller_id)
    .maybeSingle();
  const owner = ownerRow as
    | { id: string; email: string; stripe_customer_id: string | null; subscription_tier: string | null }
    | null;
  // Transfer fee is $49/Basic, $25/Full — determined by the SELLER's tier
  // at the moment the fee is charged, not the buyer's (the buyer hasn't
  // taken ownership yet).
  const sellerTier: SubscriptionTier = owner?.subscription_tier === "full" ? "full" : "basic";

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
    const priceEnvVar = sellerTier === "full" ? "STRIPE_PRICE_ID_TRANSFER_FULL" : "STRIPE_PRICE_ID_TRANSFER_BASIC";
    const priceId = process.env[priceEnvVar]?.trim();
    if (!priceId) return { error: `Missing ${priceEnvVar}.` };

    const price = await stripe.prices.retrieve(priceId);
    if (!price.unit_amount) return { error: "Transfer fee price has no unit amount configured." };
    if (price.unit_amount !== expectedAmountCents) {
      return {
        error: "The transfer fee has changed since this page loaded. Reload the page to see the current amount. Nothing has been charged.",
      };
    }

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
