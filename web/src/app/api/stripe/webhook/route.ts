import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { DORMANCY } from "@/lib/tier-config";
import { notifyOwner } from "@/lib/notify";
import { decideSubscriptionSync } from "@/lib/subscription-sync";
import { tierForPriceId } from "@/lib/stripe/tiers";
import { notifyDowngradeGraceIfDue, notifyVesselsRestored } from "@/lib/dormancy-notify";

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
        } else if (intent.metadata?.payment_type === "transfer_fee") {
          await completeOwnershipTransferFromPayment(service, intent);
        } else if (intent.metadata?.payment_type === "signup_bundle") {
          await completeSignupBundle(service, intent);
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
 * THE VESSEL CAP'S ACTUAL ENFORCEMENT.
 *
 * Every check before a payment — createVessel, and both checkout actions
 * at the Pay click — is a courtesy that keeps an owner from being charged
 * for something their plan does not cover. None of them can be the
 * guarantee: two submits in the same second both pass, a buyer can accept
 * several transfers that each see the same count, and any future path
 * that activates a vessel would never run them at all.
 *
 * This runs after the state has actually changed, against what actually
 * resulted, in the database. Over the cap starts the 14-day grace window
 * (users.downgrade_grace_until): the owner keeps the vessel they paid for
 * and chooses what stays active, or upgrades. Under it, clears any window
 * that no longer applies. Idempotent — the grace clock only starts if one
 * is not already running.
 *
 * THROWN, NOT LOGGED. POST turns a throw into a 500, Stripe redelivers,
 * and every step before this is safe to repeat (payment-row inserts are
 * guarded, activation is guarded on qr_status, completion returns early
 * when already completed, notifications dedupe on the transfer id). A
 * logged-and-swallowed failure here would leave an account over its cap
 * with nothing left that would ever reconcile it — which is the bug.
 */
async function reconcileVesselOverflow(service: ServiceClient, ownerId: string, context: string) {
  const { data, error } = await service.rpc("reconcile_vessel_overflow", { p_owner_id: ownerId });
  if (error) {
    throw new Error(`reconcile_vessel_overflow failed for owner ${ownerId} (${context}): ${error.message}`);
  }
  // {started, running, ...} since 20261002; NULL before it. Logged, not
  // acted on — see below for why the notification does not key off it.
  const result = data as { started?: boolean; grace_until?: string } | null;
  if (result?.started) {
    console.log(`[stripe-webhook] ${context}: started a downgrade grace clock for owner ${ownerId}, until ${result.grace_until}.`);
  }

  // downgrade_grace_started. Evaluated after EVERY reconcile, not only the
  // one whose result says it started a clock, and confirmed against the tier
  // Stripe reports rather than the stored one — so the signup-bundle race (a
  // clock started against a tier seconds out of date, then cleared by the
  // tier event) never emails, and a redelivery re-asks the same question
  // instead of losing the moment. Throws on a failed Stripe lookup, which
  // redelivers this event; everything above is idempotent.
  // lib/dormancy-notifications.ts has the full reasoning.
  await notifyDowngradeGraceIfDue(service, ownerId);
}

/**
 * Records a vessel-scoped charge (badge fee or transfer fee) — once.
 *
 * These inserts used to ignore their result. A failure returned 200 and the
 * charge went unrecorded forever: the service may still have been delivered,
 * but the payment was invisible to anything that reconciles money later.
 *
 * WHY THROWING IS SAFE TO RETRY. vessel_payments.stripe_payment_intent_id
 * has a unique index (20260827). A retry finds the row and returns; two
 * deliveries racing both try the insert and the loser gets 23505
 * unique_violation, which means the charge IS recorded — treated as success,
 * not as a failure to retry.
 *
 * WHY IT RUNS BEFORE THE SERVICE, and so can hold it up for one retry. A
 * transient write failure here delays activation or completion until Stripe
 * redelivers. The other order would never delay the service, but would lose
 * the record in the one case it matters most: when the service can NEVER
 * succeed. A transfer paid for after it was cancelled fails completion on
 * every attempt, and that charge needs a refund — which starts from knowing
 * it was taken. Recording first means every charge Stripe reports is on
 * file whether or not what it paid for happened.
 *
 * Note the row existing must never skip the service — only this insert.
 * An earlier delivery can record the charge and then fail before
 * activating; the retry has to carry on past this point.
 */
async function recordVesselPayment(
  service: ServiceClient,
  row: {
    vessel_id: string;
    payment_type: "badge_fee" | "transfer_fee";
    stripe_payment_intent_id: string;
    amount_cents: number;
  },
) {
  const { data: existing, error: readError } = await service
    .from("vessel_payments")
    .select("id")
    .eq("stripe_payment_intent_id", row.stripe_payment_intent_id)
    .maybeSingle();
  if (readError) {
    throw new Error(`could not check vessel_payments for ${row.stripe_payment_intent_id}: ${readError.message}`);
  }
  if (existing) return;

  const { error: insertError } = await service
    .from("vessel_payments")
    .insert({ ...row, status: "paid", paid_at: new Date().toISOString() });
  if (insertError && insertError.code !== "23505") {
    throw new Error(`could not record ${row.payment_type} ${row.stripe_payment_intent_id}: ${insertError.message}`);
  }
}

/**
 * Attempts the qr_status activation and logs the outcome explicitly —
 * success, zero-row match, or DB error — so a no-op is never
 * indistinguishable from a real activation purely by the webhook returning
 * 200. Idempotent via the WHERE qr_status='pending_payment' guard: calling
 * this again on an already-active vessel is always a harmless zero-row match.
 *
 * Returns whether the vessel is active once this is done — true for a
 * redelivery that finds it already active, too, because that is exactly
 * the retry that follows a reconcile failure and it must reconcile again.
 *
 * updated_at: this UPDATE bumps vessels.updated_at through the
 * vessels_updated_at BEFORE UPDATE trigger (supabase/seed.sql — the base
 * schema, not supabase/migrations/). apply_overflow_fallback keeps the
 * most recently updated vessels, so that bump is what stops a vessel the
 * owner has just paid for losing its slot to an older one they happened to
 * edit. Setting updated_at here as well would change nothing — the
 * trigger overwrites it — but if that trigger is ever removed, this is the
 * line that has to start setting it.
 */
async function activateVessel(
  service: ServiceClient,
  vessel: { id: string; qr_status: string | null },
  mxeId: string,
  sourceDescription: string,
): Promise<boolean> {
  if (vessel.qr_status !== "pending_payment") {
    console.log(`[stripe-webhook] ${sourceDescription}: vessel ${mxeId} already qr_status=${vessel.qr_status}, nothing to do.`);
    return vessel.qr_status === "active";
  }

  const { data: updated, error: updateError } = await service
    .from("vessels")
    .update({ qr_status: "active", qr_generated_at: new Date().toISOString() })
    .eq("id", vessel.id)
    .eq("qr_status", "pending_payment")
    .select("id");

  if (updateError) {
    // Thrown, not logged. The owner has paid; a 200 here left the vessel
    // pending with no retry, and the processing page polling forever.
    //
    // WHY A RETRY IS SAFE, for both callers (badge fee, signup bundle):
    //  - The payment-row insert before this is skipped when the row
    //    exists, backed by the unique index on stripe_payment_intent_id.
    //  - The caller re-reads qr_status on every delivery, and this UPDATE
    //    is guarded on qr_status = 'pending_payment'. If an earlier
    //    attempt's UPDATE actually committed and only the error response
    //    was spurious, the retry reads 'active', skips the update, and
    //    returns true — which still reconciles, as it must.
    //  - Reconcile, the only step after this, has not run yet, and is
    //    idempotent when it does.
    throw new Error(`activation update failed for vessel ${mxeId} (${sourceDescription}): ${updateError.message}`);
  } else if (!updated || updated.length === 0) {
    // A concurrent delivery activated it between the read and this
    // update. That delivery reconciles; this one does not need to.
    console.error(
      `[stripe-webhook] ${sourceDescription}: activation update for vessel ${mxeId} matched zero rows — ` +
        `qr_status likely changed concurrently between the read above and this update.`,
    );
    return false;
  }
  console.log(`[stripe-webhook] ${sourceDescription}: activated vessel ${mxeId} (${vessel.id}).`);
  return true;
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

  const { data: vesselRow, error: vesselError } = await service
    .from("vessels")
    .select("id, qr_status, owner_id")
    .eq("mxe_id", mxeId)
    .maybeSingle();
  // A failed read is not a missing vessel. Treating it as one returned 200
  // for a transient database error, and the paid activation it was about
  // was never attempted again — the same silent outcome as a failed
  // update, one step earlier. Nothing has been written yet, so retrying
  // is trivially safe. A vessel that genuinely is not there stays a 200:
  // retrying cannot conjure it.
  if (vesselError) {
    throw new Error(`could not read vessel ${mxeId} for payment_intent ${intent.id}: ${vesselError.message}`);
  }
  const vessel = vesselRow as { id: string; qr_status: string | null; owner_id: string } | null;
  if (!vessel) {
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id}: no vessel found for mxe_id=${mxeId}.`);
    return;
  }

  // Recorded before activating, and never skips activation when the row
  // already exists — see recordVesselPayment.
  await recordVesselPayment(service, {
    vessel_id: vessel.id,
    payment_type: "badge_fee",
    stripe_payment_intent_id: intent.id,
    amount_cents: intent.amount,
  });

  const active = await activateVessel(service, vessel, mxeId, `payment_intent.succeeded ${intent.id}`);
  // Paid is paid. An owner who lands over the cap keeps this vessel and
  // gets the grace window, never a refusal after the charge.
  if (active) await reconcileVesselOverflow(service, vessel.owner_id, `badge fee ${intent.id}, ${mxeId}`);
}

/**
 * Bundled first-vessel signup — one Stripe invoice/PaymentIntent covering
 * both the recurring plan (created via subscriptions.create, handled
 * separately by recordAccountSubscriptionInvoice below on invoice.paid)
 * and this vessel's one-time badge fee (added via add_invoice_items,
 * handled here). intent.amount is the COMBINED total — the badge-only
 * portion for vessel_payments comes from metadata.badge_fee_amount_cents,
 * tagged at creation (dashboard/[mxeId]/payment/actions.ts), not from
 * intent.amount itself.
 */
async function completeSignupBundle(service: ServiceClient, intent: Stripe.PaymentIntent) {
  const mxeId = intent.metadata?.mxe_id;
  const badgeAmountRaw = intent.metadata?.badge_fee_amount_cents;
  if (!mxeId || !badgeAmountRaw) {
    console.error(
      `[stripe-webhook] payment_intent.succeeded ${intent.id} has payment_type=signup_bundle but missing metadata.mxe_id or metadata.badge_fee_amount_cents.`,
    );
    return;
  }
  const badgeAmountCents = Number(badgeAmountRaw);
  if (!Number.isFinite(badgeAmountCents)) {
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id}: badge_fee_amount_cents metadata is not a number: ${badgeAmountRaw}.`);
    return;
  }

  const { data: vesselRow, error: vesselError } = await service
    .from("vessels")
    .select("id, qr_status, owner_id")
    .eq("mxe_id", mxeId)
    .maybeSingle();
  // A failed read is not a missing vessel. Treating it as one returned 200
  // for a transient database error, and the paid activation it was about
  // was never attempted again — the same silent outcome as a failed
  // update, one step earlier. Nothing has been written yet, so retrying
  // is trivially safe. A vessel that genuinely is not there stays a 200:
  // retrying cannot conjure it.
  if (vesselError) {
    throw new Error(`could not read vessel ${mxeId} for payment_intent ${intent.id}: ${vesselError.message}`);
  }
  const vessel = vesselRow as { id: string; qr_status: string | null; owner_id: string } | null;
  if (!vessel) {
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id}: no vessel found for mxe_id=${mxeId}.`);
    return;
  }

  // The badge portion only — the plan portion of this same charge is
  // recorded against the account by invoice.paid. Same rules as the badge
  // fee: see recordVesselPayment.
  await recordVesselPayment(service, {
    vessel_id: vessel.id,
    payment_type: "badge_fee",
    stripe_payment_intent_id: intent.id,
    amount_cents: badgeAmountCents,
  });

  const active = await activateVessel(service, vessel, mxeId, `payment_intent.succeeded ${intent.id}`);
  // Same as the badge fee. One ordering caveat specific to a bundle: the
  // plan's tier is written by invoice.paid / customer.subscription.updated,
  // which can arrive AFTER this event. Until one does, the account still
  // carries its old subscription_tier (Basic by default), so an account
  // that already held vessels and chose Full can briefly look over the cap
  // and start a grace window here. The tier-writing events reconcile too,
  // and clear it the moment the real tier lands.
  if (active) await reconcileVesselOverflow(service, vessel.owner_id, `signup bundle ${intent.id}, ${mxeId}`);
}


/**
 * Ownership Transfer fee — one-time, charged to the seller, only once
 * the buyer has already accepted. This is the moment ownership actually
 * moves: complete_ownership_transfer (20260908_ownership_transfer.sql)
 * atomically flips vessels.owner_id, clears owner-specific fields,
 * captures the seller's frozen snapshot, revokes vessel_shares, and
 * resolves the transfer row — idempotent on its own (a webhook retry
 * against an already-completed transfer is a no-op inside the
 * function), same as activateVessel's qr_status guard above.
 */
async function completeOwnershipTransferFromPayment(service: ServiceClient, intent: Stripe.PaymentIntent) {
  const transferId = intent.metadata?.transfer_id;
  const vesselId = intent.metadata?.vessel_id;
  if (!transferId) {
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id} has payment_type=transfer_fee but no metadata.transfer_id.`);
    return;
  }

  // Recorded BEFORE completion, which matters most here: if the transfer
  // was cancelled after the seller paid, completion fails on every attempt
  // and this row is the record a refund starts from.
  //
  // This used to be skipped silently when metadata carried no vessel_id.
  // createTransferFeeIntent always sets it, but the transfer row is the
  // authority, so fall back to it rather than lose the charge.
  let paymentVesselId: string | null = vesselId || null;
  if (!paymentVesselId) {
    const { data: tRow, error: tError } = await service
      .from("ownership_transfers")
      .select("vessel_id")
      .eq("id", transferId)
      .maybeSingle();
    if (tError) throw new Error(`could not read transfer ${transferId} to record its fee: ${tError.message}`);
    paymentVesselId = (tRow as { vessel_id: string } | null)?.vessel_id ?? null;
  }
  if (paymentVesselId) {
    await recordVesselPayment(service, {
      vessel_id: paymentVesselId,
      payment_type: "transfer_fee",
      stripe_payment_intent_id: intent.id,
      amount_cents: intent.amount,
    });
  } else {
    // No such transfer. Permanent — a retry cannot create one — so logged
    // rather than thrown; complete_ownership_transfer below raises "not
    // found" and that failure is thrown, which is what surfaces it.
    console.error(`[stripe-webhook] payment_intent.succeeded ${intent.id}: transfer ${transferId} not found; fee not recorded.`);
  }

  const { error } = await service.rpc("complete_ownership_transfer", {
    p_transfer_id: transferId,
    p_stripe_payment_intent_id: intent.id,
  });
  if (error) {
    // Thrown, not logged. The seller has been charged at this point; a
    // 200 here meant ownership never moved, Stripe never retried, and
    // nothing anywhere recorded that it hadn't.
    //
    // WHY A RETRY IS SAFE, specifically for this handler:
    //  - The payment-row insert above is skipped when the row exists, and
    //    vessel_payments.stripe_payment_intent_id is a unique index
    //    (20260827), so a retry, or two deliveries at once, cannot
    //    record the charge twice.
    //  - complete_ownership_transfer is one function call, so one
    //    transaction: when it raises, every write it made (history rows,
    //    the owner change, share revocation, the status flip) rolls back
    //    and a retry starts clean. If an earlier attempt actually
    //    committed and only the response was lost, the function sees
    //    status 'completed' and returns without doing anything twice.
    //  - Nothing after this point has run yet, so no notification or
    //    reconcile is repeated by the retry.
    //
    // NOT EVERY FAILURE HERE IS TRANSIENT. If the seller cancelled the
    // transfer after the payment intent was created — the transfer
    // payment page creates it on load, and carries a cancel link — the
    // function raises "not awaiting payment (status: canceled)" on every
    // attempt. Retrying that is harmless and will not resolve it: the
    // seller has paid for a transfer that no longer exists and needs a
    // refund, which is a person's decision. Failing loudly is still
    // right, because it is the only thing that puts it in front of one —
    // Stripe shows the failing delivery and the logs carry the ids.
    throw new Error(
      `complete_ownership_transfer failed for transfer ${transferId} (payment_intent ${intent.id}): ${error.message}`,
    );
  }
  console.log(`[stripe-webhook] payment_intent.succeeded ${intent.id}: completed transfer ${transferId}.`);

  // BOTH parties, and deliberately not the same message. The seller has
  // lost a vessel and been charged a fee; the buyer has gained one and
  // needs to know its documents did not come with it. One message
  // addressed to both would be useful to neither.
  //
  // Read AFTER completion, because that is when buyer_id is finally set
  // — before acceptance there is no buyer account to notify.
  const { data: doneRow } = await service
    .from("ownership_transfers")
    .select("id, seller_id, buyer_id, mxe_id, vessel_id, buyer_email")
    .eq("id", transferId)
    .maybeSingle();
  const done = doneRow as
    | { id: string; seller_id: string; buyer_id: string | null; mxe_id: string; vessel_id: string; buyer_email: string }
    | null;
  if (!done) {
    // Completion succeeded but the row can't be read back, so the buyer
    // can't be reconciled. Throw for a redelivery rather than return 200:
    // completion is idempotent, and a silent return here is an account
    // over its cap that nothing will ever look at again.
    throw new Error(`transfer ${transferId} completed but could not be read back to reconcile the buyer.`);
  }

  // The same enforcement as activation. accept_ownership_transfer checks
  // the buyer's cap — properly, in SQL, under a lock — but at ACCEPTANCE,
  // and ownership only moves here, when the seller pays, possibly days
  // later. A buyer on Basic who accepts three transfers passes three
  // checks that each see one vessel, and holds four once all three sellers
  // have paid. The seller has paid, so this does not refuse either: the
  // transfer completes, and the buyer gets the grace window.
  if (done.buyer_id) {
    await reconcileVesselOverflow(service, done.buyer_id, `transfer ${transferId} completed`);
  }

  // Keyed on the transfer id, which is also what makes this safe against
  // Stripe redelivering payment_intent.succeeded: the completion RPC is
  // already idempotent, and now the emails are too.
  await notifyOwner(
    done.seller_id,
    "transfer_completed_seller",
    `${done.mxe_id} now belongs to ${done.buyer_email}. The transfer fee has been charged.`,
    { vesselId: done.vessel_id, dedupeKey: done.id },
  );

  if (done.buyer_id) {
    await notifyOwner(
      done.buyer_id,
      "transfer_completed_buyer",
      `${done.mxe_id} is now registered to you.`,
      { vesselId: done.vessel_id, dedupeKey: done.id },
    );
  } else {
    console.error(`[stripe-webhook] transfer ${transferId} completed with no buyer_id; buyer not notified.`);
  }
}

/**
 * Account-level subscription — Basic or Full, both real recurring Stripe
 * Subscriptions now (tier structure build). One subscription per account,
 * covering every vessel that account owns. Unlike the old per-vessel
 * version, this never activates a vessel's qr_status — that's the badge
 * fee's job, unconditionally, regardless of tier. This only ever updates
 * the owner's account-level tier/status and logs the charge.
 *
 * amount_cents logged here depends on the invoice's billing_reason:
 * 'subscription_create' (a brand-new subscription's first invoice) reads
 * the subscription's own recurring price rather than invoice.amount_paid,
 * because that first invoice may have a one-time badge fee riding along
 * via add_invoice_items (the bundled signup checkout) — amount_paid would
 * double-count it. Every other reason (a plain renewal, or a
 * 'subscription_update' proration from the Basic-to-Full upgrade) has no
 * such rider, so invoice.amount_paid is both simpler and more accurate
 * there — for a proration invoice in particular, it's the only place the
 * actual net prorated charge (credit for unused Basic time included) is
 * available at all; the subscription's current recurring price alone
 * would show the full new-tier price instead of what was really charged.
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

  // items.data[0] is always the one recurring plan price — the badge fee
  // rides along on the invoice via add_invoice_items, never as a
  // subscription item, so there's exactly one item to read here regardless
  // of whether this was a plain subscription or a bundled signup.
  const planItem = subscription.items.data[0];
  const planPrice = planItem?.price;
  const tier = tierForPriceId(typeof planPrice === "string" ? planPrice : planPrice?.id);
  const subscriptionOnlyAmountCents =
    invoice.billing_reason === "subscription_create"
      ? typeof planPrice === "string"
        ? null
        : (planPrice?.unit_amount ?? null)
      : invoice.amount_paid;

  if (!tier) {
    console.error(
      `[stripe-webhook] invoice.paid ${invoice.id}: subscription ${subscription.id}'s price ${typeof planPrice === "string" ? planPrice : planPrice?.id} matches neither STRIPE_PRICE_ID_BASIC_SUBSCRIPTION nor STRIPE_PRICE_ID_FULL — leaving subscription_tier untouched.`,
    );
  }

  // stripe_customer_id, not subscription.metadata.owner_id — the customer
  // id is already the unique, indexed key every other billing lookup in
  // this codebase uses, and doesn't depend on metadata having survived
  // (metadata is still set at creation for traceability in the Stripe
  // dashboard, just not relied on here).
  const { data: ownerRow, error: ownerError } = await service
    .from("users")
    .select("id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  // A failed read is not a missing owner. Treating it as one returned 200
  // and the invoice was never recorded or applied. Nothing is written yet,
  // so the retry is trivially safe. A genuinely unknown customer stays a
  // logged 200: no retry will make one appear.
  if (ownerError) {
    throw new Error(`invoice.paid ${invoice.id}: could not look up the owner for ${customerId}: ${ownerError.message}`);
  }
  const owner = ownerRow as { id: string } | null;
  if (!owner) {
    console.error(`[stripe-webhook] invoice.paid ${invoice.id}: no user found for stripe_customer_id=${customerId}.`);
    return;
  }

  // THE RECORD. Invoice.payment_intent was also removed — the real
  // PaymentIntent now sits behind invoice.payments, a paginated list needing
  // its own expand + fetch. Not worth the extra round-trip purely for a dedup
  // key: the invoice's own id is unique per invoice and equally good.
  //
  // This insert used to ignore its result, so a failure lost the record of a
  // paid invoice with a 200. It now throws. Retry-safe for the same reason as
  // recordVesselPayment: account_payments.stripe_invoice_id is a unique index
  // (20260905), a retry finds the row, and a racing duplicate's 23505 means
  // the invoice IS recorded. Recorded whatever the subscription's state is
  // below — Stripe says this was paid, and that is the fact being filed.
  const { data: existingPayment, error: paymentReadError } = await service
    .from("account_payments")
    .select("id")
    .eq("stripe_invoice_id", invoice.id)
    .maybeSingle();
  if (paymentReadError) {
    throw new Error(`invoice.paid ${invoice.id}: could not check account_payments: ${paymentReadError.message}`);
  }
  if (!existingPayment) {
    const { error: insertError } = await service.from("account_payments").insert({
      owner_id: owner.id,
      stripe_invoice_id: invoice.id,
      amount_cents: subscriptionOnlyAmountCents,
      status: "paid",
      paid_at: new Date().toISOString(),
    });
    if (insertError && insertError.code !== "23505") {
      throw new Error(`invoice.paid ${invoice.id}: could not record the payment: ${insertError.message}`);
    }
  }

  // THE ACCOUNT UPDATE — and the reason this handler was not safe to retry
  // until now, even though the record above is.
  //
  // It wrote subscription_status 'active' unconditionally. That was merely
  // wrong on an out-of-order delivery before; with failures now thrown,
  // Stripe redelivers this event for up to ~3 days, and an invoice.paid for
  // a renewal can land after the subscription was cancelled — setting a
  // lapsed account back to 'active', repointing stripe_subscription_id at a
  // dead subscription, and passing the entitlement check in
  // choose_active_vessels. Same hazard, and the same rule, as
  // syncSubscriptionStatus (lib/subscription-sync.ts): act on the
  // subscription's CURRENT state, which `subscription` already is (it was
  // retrieved above, not read from the event).
  //
  // If it is not active now, the account is left to syncSubscriptionStatus,
  // which is driven by the status events and applies lapses and restores.
  // That also covers the brief lag where an invoice is paid before Stripe
  // has moved the subscription to active: customer.subscription.updated
  // follows and applies it.
  if (subscription.status === "active") {
    const { error: updateError } = await service
      .from("users")
      .update({
        subscription_status: "active",
        ...(tier ? { subscription_tier: tier } : {}),
        stripe_customer_id: customerId,
        stripe_subscription_id: subscription.id,
      })
      .eq("id", owner.id);
    // Used to be ignored: a failure left a paying owner on their old tier
    // or status with a 200. The update writes the same values every time,
    // so a retry is safe.
    if (updateError) {
      throw new Error(`invoice.paid ${invoice.id}: could not update account ${owner.id}: ${updateError.message}`);
    }
  } else {
    console.log(
      `[stripe-webhook] invoice.paid ${invoice.id}: recorded, but subscription ${subscription.id} is '${subscription.status}' now — leaving the account to the subscription status events.`,
    );
  }

  // This writes subscription_tier and, until now, never reconciled —
  // it relied on customer.subscription.updated arriving too. It matters
  // more now that activation reconciles: a bundled signup can be activated
  // (and reconciled against the account's OLD tier) before the new tier
  // lands, and this is one of the two events that land it. Reconciling
  // after every tier write means a window started against a stale tier is
  // cleared as soon as the real one is known, whichever event is first.
  await reconcileVesselOverflow(service, owner.id, `invoice.paid ${invoice.id}`);
}

/**
 * Stripe's own dunning/retry cycle drives these transitions — this handler
 * just reflects whatever status Stripe ultimately reports. qr_status is
 * never touched here, in either direction: it is permanent once 'active'
 * (build spec §4).
 *
 * Also drives Dormant Vessel Identity
 * (docs/moxie_digital_dormant_identity_spec.md): 'canceled'/'unpaid'
 * means Stripe's own dunning is already exhausted, so every one of the
 * owner's vessels goes dormant (cause='lapsed') immediately, no
 * additional grace. 'past_due' only starts the grace-period clock
 * (past_due_since) — set_vessels_lapsed isn't called yet; the lazy
 * apply_past_due_dormancy_if_expired check (dashboard/public-page loads,
 * plus reconcile_all_dormancy on /admin) applies it once
 * DORMANCY.PAST_DUE_GRACE_DAYS has actually elapsed. 'active' restores
 * any lapsed vessels and, either way, reconciles Basic-tier overflow —
 * covers both "recovered from past_due" and "downgraded to Basic" with
 * one call.
 */
async function syncSubscriptionStatus(service: ServiceClient, eventSubscription: Stripe.Subscription) {
  // RETRY SAFETY IS NOT THE SAME HERE AS IN THE OTHER HANDLERS — see
  // lib/subscription-sync.ts for the full reasoning. In short: vessel
  // activation and transfer completion are one-way and guarded, so a late
  // retry finds the work done. Subscription status goes back and forth, and
  // this handler used to write the status the EVENT carried. Failing loudly
  // means Stripe may redeliver this event up to ~3 days later, so first:
  //
  // Act on the subscription as it is NOW, not as the event described it.
  // Both calls are reads. If either fails, the throw becomes a 500 and the
  // delivery is retried, having written nothing.
  const stripe = getStripe();
  const subscription = await stripe.subscriptions.retrieve(eventSubscription.id);
  const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;
  const siblings = await stripe.subscriptions.list({ customer: customerId, status: "all", limit: 100 });

  const action = decideSubscriptionSync({
    currentStatus: subscription.status,
    otherSubscriptions: siblings.data.filter((s) => s.id !== subscription.id).map((s) => ({ id: s.id, status: s.status })),
  });

  if (eventSubscription.status !== subscription.status) {
    console.log(
      `[stripe-webhook] subscription ${subscription.id}: event said '${eventSubscription.status}', Stripe now says '${subscription.status}' — acting on the current status.`,
    );
  }

  if (action.kind === "superseded") {
    // Not live, and another subscription on this customer is. This one no
    // longer describes the account, and account writes are scoped by
    // customer — applying it would lapse or grace an owner who is paying.
    console.log(
      `[stripe-webhook] subscription ${subscription.id} is '${subscription.status}' but ${action.by} is live on customer ${customerId} — not applying.`,
    );
    return;
  }

  if (action.kind === "lapse") {
    // The tier/status downgrade is scoped by customer alone, same as every
    // other branch here — that must land regardless of what
    // stripe_subscription_id currently holds, so a stuck "full" tier is
    // never possible even if the ID column is somehow out of sync. (The
    // "superseded" check above is what stops customer scoping from
    // clobbering a newer subscription.)
    const { data: updatedRows, error: updateError } = await service
      .from("users")
      .update({ subscription_status: "canceled", subscription_tier: "basic", past_due_since: null })
      .eq("stripe_customer_id", customerId)
      .select("id");
    // Checked, because an unread error here meant zero rows, so the loop
    // below never ran set_vessels_lapsed — the same silent 200 one step
    // earlier. Retry-safe: nothing has been written yet.
    if (updateError) throw new Error(`lapse: users update failed for customer ${customerId}: ${updateError.message}`);

    // Clearing the ID is a separate statement, scoped to exactly the
    // subscription that just ended — keeps the column meaning "the
    // currently active subscription, if any". Idempotent, so a failure is
    // thrown and simply repeated on retry.
    const { error: clearError } = await service
      .from("users")
      .update({ stripe_subscription_id: null })
      .eq("stripe_customer_id", customerId)
      .eq("stripe_subscription_id", subscription.id);
    if (clearError) throw new Error(`lapse: clearing stripe_subscription_id failed for ${subscription.id}: ${clearError.message}`);

    const owners = (updatedRows ?? []) as { id: string }[];

    // Every lapse first, every notification after. set_vessels_lapsed used
    // to fail with a log line and a 200, leaving a cancelled account's
    // vessels fully active with nothing to retry it.
    //
    // WHY A RETRY IS SAFE: both updates above rewrite the same values;
    // set_vessels_lapsed only touches vessels still lifecycle_status =
    // 'active', so repeating it lapses nothing twice and shares already
    // revoked stay revoked. And because all lapses run before any
    // notification, a retry caused by a lapse failure has not written an
    // in-app notification row yet — notifyOwner always writes that row,
    // and only the EMAIL is deduplicated.
    for (const owner of owners) {
      const { error } = await service.rpc("set_vessels_lapsed", { p_owner_id: owner.id });
      if (error) throw new Error(`set_vessels_lapsed failed for owner ${owner.id}: ${error.message}`);
    }
    for (const owner of owners) {
      await notifyOwner(
        owner.id,
        "vessel_lapsed",
        "Your Moxie subscription has ended. Your vessels keep their permanent identity, but document access, sharing, and editing are paused until you resubscribe.",
      );
    }
    return;
  }

  if (action.kind === "past_due") {
    const { data: updatedRows, error: updateError } = await service
      .from("users")
      .update({ subscription_status: "past_due" })
      .eq("stripe_customer_id", customerId)
      .select("id");
    if (updateError) throw new Error(`past_due: users update failed for customer ${customerId}: ${updateError.message}`);

    // Only stamp past_due_since the FIRST time this account goes
    // past_due for the current failure — a repeat past_due delivery for
    // the same ongoing issue (Stripe retries several times) must not
    // reset the grace-period clock. is("past_due_since", null) guards
    // that; this is a separate, narrower statement from the one above
    // for exactly that reason. The same guard is what makes a retry safe.
    const { error: stampError } = await service
      .from("users")
      .update({ past_due_since: new Date().toISOString() })
      .eq("stripe_customer_id", customerId)
      .is("past_due_since", null);
    if (stampError) throw new Error(`past_due: stamping past_due_since failed for customer ${customerId}: ${stampError.message}`);

    for (const row of (updatedRows ?? []) as { id: string }[]) {
      await notifyOwner(
        row.id,
        "subscription_past_due",
        `Your last payment didn't go through. You have ${DORMANCY.PAST_DUE_GRACE_DAYS} days to update your payment method before your vessels' document access, sharing, and editing pause.`,
      );
    }
    return;
  }

  if (action.kind === "active") {
    const planItem = subscription.items.data[0];
    const planPrice = planItem?.price;
    const tier = tierForPriceId(typeof planPrice === "string" ? planPrice : planPrice?.id);
    if (!tier) {
      console.error(
        `[stripe-webhook] customer.subscription.updated ${subscription.id}: price ${typeof planPrice === "string" ? planPrice : planPrice?.id} matches neither STRIPE_PRICE_ID_BASIC_SUBSCRIPTION nor STRIPE_PRICE_ID_FULL — leaving subscription_tier untouched.`,
      );
    }
    const { data: updatedRows, error: updateError } = await service
      .from("users")
      .update({ subscription_status: "active", ...(tier ? { subscription_tier: tier } : {}) })
      .eq("stripe_customer_id", customerId)
      .select("id");
    if (updateError) throw new Error(`active: users update failed for customer ${customerId}: ${updateError.message}`);

    // clear_vessels_lapsed used to fail with a log line and a 200: an owner
    // who had just paid to resubscribe kept every vessel paused, and
    // nothing retried it.
    //
    // WHY A RETRY IS SAFE: the status is Stripe's current one, so a retry
    // landing after a later cancellation takes the lapse branch instead
    // of restoring anything. The users update rewrites the same values.
    // clear_vessels_lapsed is one transaction — restore lapsed vessels,
    // clear past_due_since, reconcile the cap — so a failure rolls all of
    // it back, and every part of it is idempotent when it does commit
    // (it only restores rows still dormant_cause = 'lapsed', and reconcile
    // only starts a grace clock that is not already running).
    for (const row of (updatedRows ?? []) as { id: string }[]) {
      const { data: restored, error } = await service.rpc("clear_vessels_lapsed", { p_owner_id: row.id });
      if (error) throw new Error(`clear_vessels_lapsed failed for owner ${row.id}: ${error.message}`);

      // Once for the account, and one of two types: a failed payment that
      // recovered on its own emails (nobody was watching); a resubscription
      // is in-app (the owner is at checkout). clear_vessels_lapsed returns the
      // restored ids only to the call that restored them, and classifies the
      // restore in the same transaction that clears past_due_since, so a
      // redelivery neither sends twice nor classifies differently.
      await notifyVesselsRestored(row.id, restored);

      // clear_vessels_lapsed reconciles inside SQL, which may start a grace
      // clock — resubscribing to Basic after being on Full is exactly how.
      // Same state-driven, Stripe-confirmed check as every other reconcile.
      await notifyDowngradeGraceIfDue(service, row.id);
    }
  }
}
