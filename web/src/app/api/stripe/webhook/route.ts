import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export const runtime = "nodejs";

type ServiceClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();

  if (!signature || !webhookSecret) {
    console.error("[stripe-webhook] Missing stripe-signature header or STRIPE_WEBHOOK_SECRET env var — refusing to process.");
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  // Signature verification needs the raw, untouched body — do not call
  // .json() before this.
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid signature.";
    // Loud and specific: this is the single most common local-dev failure
    // mode (STRIPE_WEBHOOK_SECRET stale after a `stripe listen` restart —
    // every restart can mint a new whsec_, and the running dev server keeps
    // whatever value it read from .env.local at boot). Every event arrives
    // and gets a 400 here, which looks nothing like a handler bug but is
    // easy to miss if you're only watching for 200s. Update
    // STRIPE_WEBHOOK_SECRET to match the current `stripe listen` session,
    // then restart the dev server — env vars are read once at boot, not
    // hot-reloaded from a running process.
    console.error(
      `[stripe-webhook] Signature verification failed: ${message}\n` +
        `  Likely cause: STRIPE_WEBHOOK_SECRET in .env.local doesn't match the current ` +
        `\`stripe listen\` session's whsec_ value. Update it and restart the dev server ` +
        `(this process won't pick up an env var change on its own).`,
    );
    return NextResponse.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service role configuration." }, { status: 500 });
  }

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const intent = event.data.object as Stripe.PaymentIntent;
        if (intent.metadata?.payment_type === "badge_fee") {
          await activateFromBadgeFee(service, intent);
        }
        break;
      }

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        await recordAccountSubscriptionInvoice(service, invoice);
        break;
      }

      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        await syncSubscriptionStatus(service, subscription);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`[stripe-webhook] Failed handling ${event.type}:`, err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/**
 * Attempts the qr_status activation and logs the outcome explicitly —
 * success, zero-row match, or DB error — so a no-op is never
 * indistinguishable from a real activation purely by the webhook returning
 * 200. Idempotent via the WHERE qr_status='pending_payment' guard: calling
 * this again on an already-active vessel is always a harmless zero-row match.
 */
async function activateVessel(
  service: ServiceClient,
  vessel: { id: string; qr_status: string | null },
  mxeId: string,
  sourceDescription: string,
) {
  if (vessel.qr_status !== "pending_payment") {
    console.log(`[stripe-webhook] ${sourceDescription}: vessel ${mxeId} already qr_status=${vessel.qr_status}, nothing to do.`);
    return;
  }

  const { data: updated, error: updateError } = await service
    .from("vessels")
    .update({ qr_status: "active", qr_generated_at: new Date().toISOString() })
    .eq("id", vessel.id)
    .eq("qr_status", "pending_payment")
    .select("id");

  if (updateError) {
    console.error(`[stripe-webhook] ${sourceDescription}: activation update for vessel ${mxeId} failed:`, updateError);
  } else if (!updated || updated.length === 0) {
    console.error(
      `[stripe-webhook] ${sourceDescription}: activation update for vessel ${mxeId} matched zero rows — ` +
        `qr_status likely changed concurrently between the read above and this update.`,
    );
  } else {
    console.log(`[stripe-webhook] ${sourceDescription}: activated vessel ${mxeId} (${vessel.id}).`);
  }
}

/**
 * Badge fee — one-time, per vessel, always. Activates that vessel's
 * qr_status regardless of the account's subscription tier; this is now
 * the ONLY thing that ever does (see recordAccountSubscriptionInvoice
 * below, which used to also activate a vessel and no longer does).
 */
async function activateFromBadgeFee(service: ServiceClient, intent: Stripe.PaymentIntent) {
  const mxeId = intent.metadata?.mxe_id;
  if (!mxeId) {
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id} has payment_type=badge_fee but no metadata.mxe_id.`);
    return;
  }

  const { data: vesselRow } = await service.from("vessels").select("id, qr_status").eq("mxe_id", mxeId).maybeSingle();
  const vessel = vesselRow as { id: string; qr_status: string | null } | null;
  if (!vessel) {
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id}: no vessel found for mxe_id=${mxeId}.`);
    return;
  }

  // Payment-record idempotency is separate from activation idempotency
  // below — this only guards against inserting the same charge twice. It
  // must NOT gate the activation attempt: an earlier delivery could have
  // inserted this row and then failed or been interrupted before ever
  // reaching activateVessel, which would otherwise leave the vessel stuck
  // pending on every subsequent retry, silently, forever.
  const { data: existingPayment } = await service
    .from("vessel_payments")
    .select("id")
    .eq("stripe_payment_intent_id", intent.id)
    .maybeSingle();

  if (!existingPayment) {
    await service.from("vessel_payments").insert({
      vessel_id: vessel.id,
      payment_type: "badge_fee",
      stripe_payment_intent_id: intent.id,
      amount_cents: intent.amount,
      status: "paid",
      paid_at: new Date().toISOString(),
    });
  }

  await activateVessel(service, vessel, mxeId, `payment_intent.succeeded ${intent.id}`);
}

/**
 * Full Access subscription — account-level (build spec §9 item 16). One
 * subscription per account, covering every vessel that account owns.
 * Unlike the old per-vessel version, this never activates a vessel's
 * qr_status — that's the badge fee's job, unconditionally, regardless of
 * tier. This only ever updates the owner's account-level tier/status and
 * logs the charge.
 */
async function recordAccountSubscriptionInvoice(service: ServiceClient, invoice: Stripe.Invoice) {
  // Invoice.subscription was removed from the Stripe API (installed SDK:
  // stripe@22) — the subscription now lives under parent.subscription_details.
  const subscriptionDetails = invoice.parent?.subscription_details;
  const subscriptionId =
    typeof subscriptionDetails?.subscription === "string"
      ? subscriptionDetails.subscription
      : subscriptionDetails?.subscription?.id;
  if (!subscriptionId) {
    console.error(
      `[stripe-webhook] invoice.paid ${invoice.id} has no parent.subscription_details.subscription — ` +
        `not a subscription invoice? billing_reason=${invoice.billing_reason}, parent.type=${invoice.parent?.type}.`,
    );
    return;
  }

  const subscription = await getStripe().subscriptions.retrieve(subscriptionId);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  // stripe_customer_id, not subscription.metadata.owner_id — the customer
  // id is already the unique, indexed key every other billing lookup in
  // this codebase uses, and doesn't depend on metadata having survived
  // (metadata is still set at creation for traceability in the Stripe
  // dashboard, just not relied on here).
  const { data: ownerRow } = await service
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  const owner = ownerRow as { id: string } | null;
  if (!owner) {
    console.error(`[stripe-webhook] invoice.paid ${invoice.id}: no user found for stripe_customer_id=${customerId}.`);
    return;
  }

  // Invoice.payment_intent was also removed — the real PaymentIntent now
  // sits behind invoice.payments, a paginated list needing its own expand
  // + fetch. Not worth the extra round-trip purely for a dedup key: the
  // invoice's own id is unique per invoice and equally good for idempotency.
  const { data: existingPayment } = await service
    .from("account_payments")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();

  if (!existingPayment) {
    await service.from("account_payments").insert({
      owner_id: owner.id,
      stripe_invoice_id: invoice.id,
      amount_cents: invoice.amount_paid,
      status: "paid",
      paid_at: new Date().toISOString(),
    });
  }

  await service
    .from("users")
    .update({
      subscription_status: "active",
      subscription_tier: "full",
      stripe_customer_id: customerId,
      stripe_subscription_id: subscription.id,
    })
    .eq("id", owner.id);
}

/**
 * Stripe's own dunning/retry cycle drives these transitions — this handler
 * just reflects whatever status Stripe ultimately reports. qr_status is
 * never touched here, in either direction: it is permanent once 'active'
 * (build spec §4).
 */
async function syncSubscriptionStatus(service: ServiceClient, subscription: Stripe.Subscription) {
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  if (subscription.status === "canceled" || subscription.status === "unpaid") {
    // The tier/status downgrade is scoped by customer alone, same as every
    // other branch here — that must land regardless of what
    // stripe_subscription_id currently holds, so a stuck "full" tier is
    // never possible even if the ID column is somehow out of sync.
    await service
      .from("users")
      .update({ subscription_status: "canceled", subscription_tier: "basic" })
      .eq("stripe_customer_id", customerId);

    // Clearing the ID is a separate, best-effort statement, scoped to
    // exactly the subscription that just ended — keeps the column meaning
    // "the currently active subscription, if any" without risking, in
    // some future world with more than one subscription in play, clearing
    // a different (possibly still-active) subscription's ID than the one
    // this event is actually about.
    await service
      .from("users")
      .update({ stripe_subscription_id: null })
      .eq("stripe_customer_id", customerId)
      .eq("stripe_subscription_id", subscription.id);
  } else if (subscription.status === "past_due") {
    await service.from("users").update({ subscription_status: "past_due" }).eq("stripe_customer_id", customerId);
  } else if (subscription.status === "active") {
    await service
      .from("users")
      .update({ subscription_status: "active", subscription_tier: "full" })
      .eq("stripe_customer_id", customerId);
  }
}
