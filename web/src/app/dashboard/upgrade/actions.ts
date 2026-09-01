"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";

type IntentResult = { clientSecret: string } | { error: string };

/**
 * Creates the client secret for the account's Full Access subscription.
 * Account-level, not tied to any vessel (build spec §9 item 16 — confirmed
 * live that the old version created a new Stripe subscription per vessel
 * an owner upgraded, instead of one plan covering the whole account).
 *
 * Guarded so this can only ever create one subscription per account: an
 * owner already on active Full gets an error here rather than a second
 * Stripe Subscription object, which is exactly the bug this replaces.
 */
export async function createFullAccessUpgradeIntent(): Promise<IntentResult> {
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
    subscription_tier: string | null;
    subscription_status: string | null;
  };

  const normalizedEmail = user.email?.trim().toLowerCase();
  let owner: OwnerRow | null = null;

  if (normalizedEmail) {
    const { data: ownerRow } = await service
      .from("users")
      .select("id, email, stripe_customer_id, subscription_tier, subscription_status")
      .eq("email", normalizedEmail)
      .maybeSingle();
    owner = ownerRow as OwnerRow | null;
  }

  if (!owner) {
    const { data: ownerRow } = await service
      .from("users")
      .select("id, email, stripe_customer_id, subscription_tier, subscription_status")
      .eq("id", user.id)
      .maybeSingle();
    owner = ownerRow as OwnerRow | null;
  }

  if (!owner) return { error: "Owner account not found." };

  if (owner.subscription_tier === "full" && owner.subscription_status === "active") {
    return { error: "Already on Full Access." };
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

    const priceId = process.env.STRIPE_PRICE_ID_FULL?.trim();
    if (!priceId) return { error: "Missing STRIPE_PRICE_ID_FULL." };

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: priceId }],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      // See dashboard/[mxeId]/payment/actions.ts's original comment on this
      // exact expand path — same Stripe API-version reasoning applies here.
      expand: ["latest_invoice", "latest_invoice.confirmation_secret"],
      metadata: { owner_id: owner.id },
    });

    const invoice = subscription.latest_invoice;
    const clientSecret =
      invoice && typeof invoice !== "string" ? (invoice.confirmation_secret?.client_secret ?? null) : null;

    if (!clientSecret) {
      console.error(
        `[upgrade] Full-tier subscription ${subscription.id} (owner=${owner.id}) returned no confirmation_secret.client_secret. ` +
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
    console.error(`[upgrade] createFullAccessUpgradeIntent failed for owner ${owner.id}:`, err);
    return { error: err instanceof Error ? err.message : "Could not start checkout. Please try again." };
  }
}
