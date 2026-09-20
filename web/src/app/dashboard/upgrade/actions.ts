"use server";

import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import type Stripe from "stripe";
import { getStripe } from "@/lib/stripe/server";
import { ensureOwnerAccount } from "@/lib/owner-account";
import { IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES } from "@/lib/stripe/payment-methods";
import { releaseAbandonedSubscription } from "@/lib/stripe/abandoned-subscription";
import { quoteTierUpgrade, TIER_UPGRADE_PAYMENT_TYPE, UPGRADE_FORM_SETUP_FUTURE_USAGE } from "@/lib/stripe/tier-upgrade";
import type { SubscriptionTier } from "@/lib/tier-config";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Creates the account's plan subscription — Basic or Full — and returns
 * the client secret of its first invoice. Account-level, not tied to any
 * vessel (build spec §9 item 16).
 *
 * This is the plan picker for an account with no plan: one that never had
 * one, or a cancelled owner resubscribing. Switching FROM an active plan
 * isn't handled here — Full → Basic is the Billing Portal, Basic → Full is
 * upgradeToFullAccess below.
 *
 * CALLED AT THE PAY CLICK, like every other checkout (see the note at the
 * top of dashboard/[mxeId]/payment/actions.ts). It used to run when a plan
 * was chosen, so every plan pick created a subscription and every "Change
 * plan" orphaned one: the stored id was overwritten and nothing cancelled
 * the old subscription. UpgradeForm now mounts Elements in deferred mode
 * and calls this from its submit handler.
 *
 * CARD ONLY. It used Stripe's automatic payment methods, which offered
 * bank debit on the path a cancelled owner comes back through. See
 * lib/stripe/payment-methods.ts.
 */
export async function createPlanSubscriptionIntent(tier: SubscriptionTier): Promise<IntentResult> {
  // A server action's arguments come from the client.
  if (tier !== "basic" && tier !== "full") {
    return { error: "Choose a plan." };
  }

  const authClient = await requireSupabaseServerClient("app/dashboard/upgrade/actions");

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/app/dashboard/upgrade/actions");

  // Buying a plan is a first meaningful action, so it creates the account
  // row if signing up hasn't yet (signing up creates an Auth account and
  // nothing else). Before this, choosing a plan before registering a boat
  // dead-ended on "Owner account not found." — a true statement about our
  // schema, offered to someone who had done nothing wrong.
  const owner = await ensureOwnerAccount(service, user);
  if (!owner) return { error: "Owner account not found." };

  if (owner.subscription_status === "active") {
    return { error: "Your account already has an active plan. Use Manage Billing to change or cancel it." };
  }
  // The page sends past_due to PastDueBillingPrompt and never offers this
  // form, but the action is callable directly. A delinquent subscription
  // still exists; a second one would bill the account twice.
  if (owner.subscription_status === "past_due") {
    return { error: "Your plan has a failed payment. Update your payment method in Manage Billing to restore it." };
  }

  const stripe = getStripe();

  let customerId = owner.stripe_customer_id;

  if (customerId) {
    // A stored id doesn't mean Stripe still recognizes it — see the same
    // check in dashboard/[mxeId]/payment/actions.ts for why this can't be
    // trusted blindly.
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
  // ID from env, a customer id) that can be wrong in ways that only
  // surface at request time — a stale/wrong/wrong-mode price ID, a
  // restricted account, etc. Catching here and returning a clean
  // {error} — rather than letting the exception propagate up through the
  // Server Action boundary — matters because Next.js redacts a *thrown*
  // server action error down to a generic message in production; a
  // returned {error} string reaches the client's UI verbatim instead.
  try {
    // A subscription left on file by an earlier Pay click that didn't
    // finish is cancelled and cleared; a live one refuses. Shared with the
    // signup bundle — see lib/stripe/abandoned-subscription.ts.
    const blocked = await releaseAbandonedSubscription(stripe, service, owner);
    if (blocked) return blocked;

    const priceEnvVar = tier === "full" ? "STRIPE_PRICE_ID_FULL" : "STRIPE_PRICE_ID_BASIC_SUBSCRIPTION";
    const priceId = process.env[priceEnvVar]?.trim();
    if (!priceId) return { error: `Missing ${priceEnvVar}.` };

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner.email ?? user.email ?? undefined,
        metadata: { user_id: owner.id },
      });
      customerId = customer.id;
      await service.from("users").update({ stripe_customer_id: customerId }).eq("id", owner.id);
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      // The first invoice and every renewal accept immediate-settlement
      // methods only. Must match UpgradeForm's Elements — see
      // lib/stripe/payment-methods.ts.
      payment_settings: {
        save_default_payment_method: "on_subscription",
        payment_method_types: [...IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES],
      },
      // See dashboard/[mxeId]/payment/actions.ts's original comment on this
      // exact expand path — same Stripe API-version reasoning applies here.
      expand: ["latest_invoice", "latest_invoice.confirmation_secret"],
      metadata: { owner_id: owner.id, tier },
    });

    const invoice = subscription.latest_invoice;
    const clientSecret =
      invoice && typeof invoice !== "string" ? (invoice.confirmation_secret?.client_secret ?? null) : null;

    if (!clientSecret) {
      console.error(
        `[upgrade] ${tier}-tier subscription ${subscription.id} (owner=${owner.id}) returned no confirmation_secret.client_secret. ` +
          `latest_invoice=${typeof invoice === "string" ? invoice : (invoice?.id ?? "null")}, ` +
          `has_confirmation_secret=${typeof invoice !== "string" && !!invoice?.confirmation_secret}`,
      );
      return { error: "Stripe did not return a payment client secret for the subscription." };
    }

    // Record the subscription id as soon as it exists, ahead of the
    // webhook — the webhook (invoice.paid) is what flips
    // subscription_status/tier to active, but stripe_subscription_id
    // itself is safe to set immediately since Stripe already assigned it
    // the moment subscriptions.create() returned, regardless of whether
    // the first invoice ends up paid.
    await service.from("users").update({ stripe_subscription_id: subscription.id }).eq("id", owner.id);

    const paymentIntentId = clientSecret.split("_secret_")[0];
    if (paymentIntentId) {
      try {
        await stripe.paymentIntents.update(paymentIntentId, {
          metadata: { owner_id: owner.id, payment_type: "subscription" },
        });
      } catch (err) {
        console.error(`[upgrade] Failed to tag PaymentIntent ${paymentIntentId} with metadata:`, err);
      }
    }

    return { clientSecret };
  } catch (err) {
    console.error(`[upgrade] createPlanSubscriptionIntent failed for owner ${owner.id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start checkout. Please try again." };
  }
}

type UpgradeResult = { clientSecret: string } | { error: string; code?: "AMOUNT_CHANGED" | "STALE_QUOTE" };

/**
 * Basic -> Full, at the Pay click. Charges the prorated difference for the
 * rest of the current period as a standalone invoice; the subscription is
 * not touched here. The webhook swaps it to the Full price after the invoice
 * is paid (lib/stripe/tier-upgrade.ts has the full reasoning).
 *
 * It used to swap the subscription item first. Stripe applies a swap when it
 * is requested, so asking to see the total left the account on the Full
 * price in Stripe whether or not the owner paid.
 *
 * `expectedAmountCents` and `prorationDate` are what the page quoted. The
 * quote is recomputed here with the same proration_date and must match, so
 * the owner is never charged a figure they weren't shown.
 */
export async function upgradeToFullAccess(input: { expectedAmountCents: number; prorationDate: number }): Promise<UpgradeResult> {
  const expectedAmountCents = input?.expectedAmountCents;
  if (typeof expectedAmountCents !== "number" || !Number.isInteger(expectedAmountCents) || expectedAmountCents <= 0) {
    return { error: "Reload the page to see your upgrade total." };
  }

  const authClient = await requireSupabaseServerClient("app/dashboard/upgrade/actions");

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/app/dashboard/upgrade/actions");
  type OwnerRow = {
    id: string;
    subscription_tier: string | null;
    subscription_status: string | null;
    stripe_subscription_id: string | null;
  };

  const normalizedEmail = user.email?.trim().toLowerCase();
  let owner: OwnerRow | null = null;

  if (normalizedEmail) {
    const { data: ownerRow } = await service
      .from("users")
      .select("id, subscription_tier, subscription_status, stripe_subscription_id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    owner = ownerRow as OwnerRow | null;
  }
  if (!owner) {
    const { data: ownerRow } = await service
      .from("users")
      .select("id, subscription_tier, subscription_status, stripe_subscription_id")
      .eq("id", user.id)
      .maybeSingle();
    owner = ownerRow as OwnerRow | null;
  }

  if (!owner) return { error: "Owner account not found." };
  if (owner.subscription_tier === "full") return { error: "Already on Full Access." };
  // Active only. A past_due plan is sent to its payment method by the page;
  // charging an upgrade on top of a failed renewal is not this page's job.
  if (owner.subscription_status !== "active") {
    return { error: "Your account doesn't have an active plan to upgrade." };
  }
  if (!owner.stripe_subscription_id) {
    return { error: "No subscription found on your account to upgrade." };
  }

  const stripe = getStripe();
  const now = Math.floor(Date.now() / 1000);

  try {
    // 1. Recompute the quote — reads only. Refuses a stale or future date.
    const quote = await quoteTierUpgrade(stripe, {
      subscriptionId: owner.stripe_subscription_id,
      prorationDate: input.prorationDate,
      now,
    });
    if ("error" in quote) return quote;
    if (quote.amountCents !== expectedAmountCents) {
      return {
        error: "Your upgrade total has changed since this page loaded. Reload to see the current amount — nothing has been charged.",
        code: "AMOUNT_CHANGED",
      };
    }

    const isUpgradeInvoice = (inv: Stripe.Invoice) =>
      inv.metadata?.payment_type === TIER_UPGRADE_PAYMENT_TYPE && inv.metadata?.subscription_id === quote.subscriptionId;

    // 2. Paid but not yet applied. The subscription is still on Basic
    //    (quoteTierUpgrade checked), so a paid upgrade invoice means the
    //    webhook hasn't swapped it yet — or couldn't. A second charge would
    //    pay for the same upgrade twice.
    for await (const paid of stripe.invoices.list({
      customer: quote.customerId,
      status: "paid",
      created: { gte: now - 7 * 24 * 60 * 60 },
      limit: 100,
    })) {
      if (isUpgradeInvoice(paid)) {
        return { error: "Your upgrade payment has already been received and is being applied. Refresh in a minute rather than paying again." };
      }
    }

    // 3. Earlier Pay clicks that didn't finish leave open invoices (they
    //    are never auto-collected). Void them, so only this one can be paid.
    //    A void that fails means one is being paid right now: refuse.
    for await (const open of stripe.invoices.list({ customer: quote.customerId, status: "open", limit: 100 })) {
      if (!isUpgradeInvoice(open)) continue;
      try {
        await stripe.invoices.voidInvoice(open.id);
      } catch (err) {
        console.error(`[upgrade] could not void earlier upgrade invoice ${open.id} for owner ${owner.id}:`, err);
        return { error: "An upgrade payment is already in progress. Refresh in a minute rather than paying again." };
      }
    }

    // 4. The invoice. Standalone (not attached to the subscription), card
    //    only, auto-collection off, and excluding anything else pending on
    //    the customer — it charges exactly the quoted proration.
    const metadata = {
      payment_type: TIER_UPGRADE_PAYMENT_TYPE,
      owner_id: owner.id,
      subscription_id: quote.subscriptionId,
      subscription_item_id: quote.subscriptionItemId,
      to_price: quote.fullPriceId,
      proration_date: String(quote.prorationDate),
    };
    const draft = await stripe.invoices.create({
      customer: quote.customerId,
      auto_advance: false,
      collection_method: "charge_automatically",
      pending_invoice_items_behavior: "exclude",
      // Must match UpgradeToFullForm's Elements — see lib/stripe/payment-methods.ts.
      payment_settings: { payment_method_types: [...IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES] },
      description: "Upgrade to Full Access for the rest of your current billing period",
      metadata,
    });

    try {
      await stripe.invoiceItems.create({
        customer: quote.customerId,
        invoice: draft.id,
        amount: quote.amountCents,
        currency: quote.currency,
        description: "Full Access for the rest of this billing period, less unused Basic time",
        metadata,
      });
    } catch (err) {
      await stripe.invoices.del(draft.id).catch(() => {});
      throw err;
    }

    const finalized = await stripe.invoices.finalizeInvoice(draft.id, {
      auto_advance: false,
      expand: ["confirmation_secret"],
    });
    const clientSecret = finalized.confirmation_secret?.client_secret ?? null;
    if (finalized.amount_due !== quote.amountCents || !clientSecret) {
      console.error(
        `[upgrade] invoice ${finalized.id} (owner=${owner.id}) finalized with amount_due=${finalized.amount_due}, quoted ${quote.amountCents}, client_secret=${!!clientSecret} — voiding.`,
      );
      await stripe.invoices.voidInvoice(finalized.id).catch(() => {});
      return { error: "Couldn't prepare the upgrade payment. Nothing has been charged — please try again." };
    }

    // 5. The intent must match the deferred form, which mounts with no
    //    setup_future_usage. Read in test mode as null both without and with
    //    a saved card (see UPGRADE_FORM_SETUP_FUTURE_USAGE). Kept as a guard:
    //    a mismatch would fail at confirmation without charging; this fails
    //    the same way, but says why, logs the value, and voids the invoice.
    const paymentIntentId = clientSecret.split("_secret_")[0];
    const intent = await stripe.paymentIntents.retrieve(paymentIntentId);
    if ((intent.setup_future_usage ?? null) !== UPGRADE_FORM_SETUP_FUTURE_USAGE) {
      console.error(
        `[upgrade] invoice ${finalized.id} (owner=${owner.id}): PaymentIntent ${intent.id} has setup_future_usage=${intent.setup_future_usage}, the form mounts with ${UPGRADE_FORM_SETUP_FUTURE_USAGE} — voiding.`,
      );
      await stripe.invoices.voidInvoice(finalized.id).catch(() => {});
      return { error: "Couldn't prepare the upgrade payment. Nothing has been charged — please try again later." };
    }

    // Traceability only: the webhook routes on the INVOICE's metadata.
    await stripe.paymentIntents
      .update(paymentIntentId, { metadata: { owner_id: owner.id, payment_type: TIER_UPGRADE_PAYMENT_TYPE, invoice_id: finalized.id } })
      .catch((err) => console.error(`[upgrade] Failed to tag PaymentIntent ${paymentIntentId}:`, err));

    return { clientSecret };
  } catch (err) {
    console.error(`[upgrade] upgradeToFullAccess failed for owner ${owner.id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start the upgrade. Please try again." };
  }
}
