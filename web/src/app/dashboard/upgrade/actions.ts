"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import type { SubscriptionTier } from "@/lib/tier-config";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Creates the client secret for the account's plan subscription — Basic
 * or Full, both real recurring Stripe Subscriptions now (tier structure
 * build). Account-level, not tied to any vessel (build spec §9 item 16 —
 * confirmed live that the old version created a new Stripe subscription
 * per vessel an owner upgraded, instead of one plan covering the whole
 * account).
 *
 * This is the "pick or change your plan outside the bundled first-vessel
 * checkout" path: an account with no active plan yet reaching this page
 * directly, or one switching tiers. Switching FROM an already-active plan
 * (e.g. Full back down to Basic) isn't handled here — that's a proration
 * question best left to Stripe's own Billing Portal (openBillingPortal),
 * already the designated "manage billing" surface for anyone with an
 * active subscription. This action only ever creates a plan for an
 * account that doesn't have one, mirroring the guard the old Full-only
 * version already had, just generalized from "already Full" to "already
 * has any active subscription."
 */
export async function createPlanSubscriptionIntent(tier: SubscriptionTier): Promise<IntentResult> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  type OwnerRow = {
    id: string;
    email: string;
    stripe_customer_id: string | null;
    subscription_status: string | null;
  };

  const normalizedEmail = user.email?.trim().toLowerCase();
  let owner: OwnerRow | null = null;

  if (normalizedEmail) {
    const { data: ownerRow } = await service
      .from("users")
      .select("id, email, stripe_customer_id, subscription_status")
      .eq("email", normalizedEmail)
      .maybeSingle();
    owner = ownerRow as OwnerRow | null;
  }

  if (!owner) {
    const { data: ownerRow } = await service
      .from("users")
      .select("id, email, stripe_customer_id, subscription_status")
      .eq("id", user.id)
      .maybeSingle();
    owner = ownerRow as OwnerRow | null;
  }

  if (!owner) return { error: "Owner account not found." };

  if (owner.subscription_status === "active") {
    return { error: "Your account already has an active plan. Use Manage Billing to change or cancel it." };
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
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: owner.email ?? user.email ?? undefined,
        metadata: { user_id: owner.id },
      });
      customerId = customer.id;
      await service.from("users").update({ stripe_customer_id: customerId }).eq("id", owner.id);
    }

    const priceEnvVar = tier === "full" ? "STRIPE_PRICE_ID_FULL" : "STRIPE_PRICE_ID_BASIC_SUBSCRIPTION";
    const priceId = process.env[priceEnvVar]?.trim();
    if (!priceId) return { error: `Missing ${priceEnvVar}.` };

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
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

type UpgradeResult =
  | { amountCents: number; currency: string; clientSecret: string | null; customerSessionClientSecret: string | null }
  | { error: string };

/**
 * Basic → Full mid-cycle upgrade, via Stripe's native proration
 * (proration_behavior: 'create_prorations') on the SAME subscription and
 * billing anchor — the account keeps renewing on its usual date, just at
 * the Full price from now on, and this one invoice charges the
 * difference: the remaining-period Full charge minus a credit for the
 * unused Basic time. Recommended and confirmed over "full price, fresh
 * year" (which claws back paid-for time — the same "feels punitive"
 * problem flagged for the badge-fee bundling) and "wait until renewal"
 * (which defeats the point of a contextual upgrade prompt that needs to
 * unlock access now).
 *
 * Three Stripe calls, deliberately not one:
 *
 * 1. subscriptions.update() swaps the item to the Full price. This
 *    account's subscriptions use Stripe's "flexible" billing_mode
 *    (confirmed directly against a real subscription, then reverted —
 *    see the diagnosis this fix is based on), under which a price change
 *    with proration does NOT synchronously create/finalize an invoice
 *    the way "classic" billing mode used to. It only records pending
 *    proration invoice items on the subscription. This was the original
 *    bug: the old code read `latest_invoice` off this same call's
 *    response and got back the subscription's stale, already-paid FIRST
 *    invoice (from signup) instead of anything related to this upgrade —
 *    same dollar amount and everything, which is exactly why the UI
 *    showed a real-looking total that led nowhere. subscription.
 *    latest_invoice must never be read for a charge amount again.
 * 2. invoices.create({ subscription: ... }) bills exactly THIS
 *    subscription's pending items as a fresh, standalone draft invoice —
 *    scoped to this subscription only (Stripe's own guarantee), so it
 *    can never pick up an unrelated pending item.
 * 3. invoices.finalizeInvoice(..., { auto_advance: false }) locks in the
 *    amount and mints a real PaymentIntent, WITHOUT letting Stripe
 *    auto-collect off-session — auto_advance:false on finalize means
 *    Stripe's own collection engine leaves the invoice alone afterward.
 *    That matters specifically because this account already has a saved
 *    default payment method: without this, Stripe would likely just
 *    auto-charge it immediately with no chance for the customer to pick
 *    a different card, which defeats the point of offering a choice.
 *
 * Also creates a Stripe Customer Session with payment_method_redisplay
 * enabled — without it, PaymentElement defaults to NOT showing any
 * saved payment methods at all (Stripe's own default is `disabled`), so
 * the customer would see a blank "enter a new card" form every time
 * regardless of what's already on file. With it, the saved default
 * shows pre-selected for a one-click confirm, alongside the option to
 * add a different card — confirming with a different card here doesn't
 * change the subscription's own default payment method, so future
 * renewals keep using whatever was already on file unless changed via
 * Manage Billing.
 *
 * Swapping a subscription item's price this way (step 1) is safe to call
 * even if the resulting invoice is never paid: Stripe holds the change
 * in `pending_update` until an invoice for it is actually paid, so an
 * abandoned upgrade never leaves the account half-upgraded. That's also
 * why this needs no race guard like the bundled signup checkout's
 * stripe_subscription_id dance — there's nothing here for two concurrent
 * attempts to collide over.
 *
 * clientSecret can legitimately be null: if the prorated credit already
 * covers the full new-period charge (amount_due = 0 — not expected in
 * practice since Full is well above Basic at any elapsed fraction of a
 * year, but Stripe finalizes a $0 invoice as paid immediately with no
 * PaymentIntent to confirm), there's nothing for the client to confirm —
 * the caller should treat a null clientSecret as "already done" and go
 * straight to the processing/poller page.
 */
export async function upgradeToFullAccess(): Promise<UpgradeResult> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

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
  if (owner.subscription_status !== "active" && owner.subscription_status !== "past_due") {
    return { error: "Your account doesn't have an active plan to upgrade — choose a plan instead." };
  }
  if (!owner.stripe_subscription_id) {
    return { error: "No subscription found on your account to upgrade." };
  }

  const stripe = getStripe();

  try {
    const subscription = await stripe.subscriptions.retrieve(owner.stripe_subscription_id);
    const item = subscription.items.data[0];
    if (!item) return { error: "Could not find your subscription's plan item." };

    const fullPriceId = process.env.STRIPE_PRICE_ID_FULL?.trim();
    if (!fullPriceId) return { error: "Missing STRIPE_PRICE_ID_FULL." };

    if (item.price.id === fullPriceId) return { error: "Already on Full Access." };

    const customerId = typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

    // Step 1 — swap the item. Records pending proration items; does NOT
    // itself create an invoice under this account's billing_mode (see
    // function doc comment). No payment_behavior needed here since
    // there's no invoice for this call to attach one to.
    await stripe.subscriptions.update(owner.stripe_subscription_id, {
      items: [{ id: item.id, price: fullPriceId }],
      proration_behavior: "create_prorations",
      metadata: { owner_id: owner.id, tier: "full", upgrade_from: "basic" },
    });

    // Step 2 — invoice exactly this subscription's pending items now, as
    // a standalone draft. auto_advance defaults to false, but stated
    // explicitly since correctness here depends on it.
    const draftInvoice = await stripe.invoices.create({
      customer: customerId,
      subscription: owner.stripe_subscription_id,
      auto_advance: false,
      metadata: { owner_id: owner.id, tier: "full", upgrade_from: "basic" },
    });

    // Step 3 — finalize without letting Stripe auto-collect off-session,
    // so the only path to payment is the client's own explicit confirm.
    const finalized = await stripe.invoices.finalizeInvoice(draftInvoice.id, {
      auto_advance: false,
      expand: ["confirmation_secret"],
    });

    const amountCents = finalized.amount_due;
    const currency = finalized.currency;
    // A $0-due invoice (credit fully covers the prorated charge) has
    // nothing to confirm — clientSecret stays null, which the caller
    // treats as "nothing left to pay."
    const clientSecret = finalized.confirmation_secret?.client_secret ?? null;

    // A real amount due with nothing to confirm is exactly the failure
    // mode that produced the original hang (a stale invoice's amount
    // shown with a dead-end payment step) — surface it as a visible
    // error instead of ever handing the client a state it can't resolve.
    if (!clientSecret && amountCents > 0) {
      console.error(
        `[upgrade] upgradeToFullAccess: invoice ${finalized.id} (owner=${owner.id}) has amount_due=${amountCents} but no confirmation_secret — status=${finalized.status}.`,
      );
      return { error: "Stripe did not return a payment client secret for the upgrade. Please try again or contact support." };
    }

    let customerSessionClientSecret: string | null = null;

    if (clientSecret) {
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

      // Without this, PaymentElement's default is to show NO saved
      // payment methods at all (payment_method_redisplay defaults to
      // 'disabled') — the customer would see a blank "enter a card" form
      // every time regardless of what's already on file. This is what
      // makes the saved card show up pre-selected, with the option to
      // switch to a different one or add a new card.
      try {
        const session = await stripe.customerSessions.create({
          customer: customerId,
          components: {
            payment_element: {
              enabled: true,
              features: {
                payment_method_redisplay: "enabled",
                payment_method_redisplay_limit: 3,
                payment_method_save: "enabled",
                payment_method_save_usage: "off_session",
                payment_method_remove: "disabled",
              },
            },
          },
        });
        customerSessionClientSecret = session.client_secret;
      } catch (err) {
        // Non-fatal — worst case, PaymentElement falls back to its
        // default (no saved-method picker, blank card form). Better to
        // let the upgrade proceed than block it on this.
        console.error(`[upgrade] Failed to create Customer Session for ${customerId}:`, err);
      }
    }

    return { amountCents, currency, clientSecret, customerSessionClientSecret };
  } catch (err) {
    console.error(`[upgrade] upgradeToFullAccess failed for owner ${owner.id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start the upgrade. Please try again." };
  }
}
