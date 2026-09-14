"use client";

import { useState, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { ShippingAddressSection, saveShippingAddress } from "./ShippingAddressSection";
import { CapReachedNotice } from "./CapReachedNotice";
import { createBadgeFeeIntent } from "./actions";
import { BADGE_FEE_AMOUNT_USD, type SubscriptionTier } from "@/lib/tier-config";
import type { BadgeFeeAmount } from "@/lib/stripe/checkout-amounts";

type Props = {
  mxeId: string;
  vesselName: string;
  vesselTag: string;
  publishableKey: string;
  /** The real Stripe Price amount. Elements mounts with it before any intent exists. */
  amount: BadgeFeeAmount;
};

// Placeholder amount, read from lib/tier-config.ts rather than hardcoded
// here — needs to match whatever STRIPE_PRICE_ID_BADGE is configured to
// in Stripe.
const BADGE_FEE_COPY = {
  price: `$${BADGE_FEE_AMOUNT_USD}`,
  cadence: "one-time",
  features: [
    "Weatherproof QR badge, printed & shipped",
    "Live public + owner profile",
    "CA Boater Card included — always, on every plan",
    "Photo + registration document storage",
  ],
};

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function PaymentForm({ mxeId, vesselName, vesselTag, publishableKey, amount }: Props) {
  const stripe = getStripeJs(publishableKey);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Final step · Activate
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            One boat, <em className="text-[var(--gold-deep)] not-italic">one identity.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Your badge prints and ships the moment this clears. {vesselName}&apos;s profile goes live at the same
            time — anyone who scans it from then on sees a real, active vessel identity.
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{vesselTag}</p>
        </header>

        <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <span className="font-[family-name:var(--font-display)] text-xl italic text-[var(--navy)]">
              Badge activation
            </span>
            <div className="text-right">
              <div className="font-[family-name:var(--font-dm)] text-xl font-semibold text-[var(--navy)]">
                {BADGE_FEE_COPY.price}
              </div>
              <div className="font-[family-name:var(--font-dm)] text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
                {BADGE_FEE_COPY.cadence}
              </div>
            </div>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5">
            {BADGE_FEE_COPY.features.map((f) => (
              <li key={f} className="font-[family-name:var(--font-dm)] text-[13px] leading-relaxed text-[var(--text2)]">
                — {f}
              </li>
            ))}
          </ul>
          <p className="mt-3 font-[family-name:var(--font-dm)] text-[11px] italic leading-relaxed text-[var(--text3)]">
            Every vessel needs its own badge — this covers {vesselName}&apos;s specifically. Want unlimited
            documents, sharing, and email reminders across your whole fleet? That&apos;s Full Access, a separate
            account-wide upgrade available anytime from Account &amp; Billing.
          </p>
        </div>

        <div className="mt-8">
          {/* Deferred mode: amount and currency, no PaymentIntent. Nothing
              is created in Stripe by loading this page — the intent is
              created by the Pay click, after the vessel cap is checked. */}
          <Elements stripe={stripe} options={{ mode: "payment", amount: amount.badgeCents, currency: amount.currency }}>
            <CheckoutInner mxeId={mxeId} vesselName={vesselName} />
          </Elements>
        </div>
      </main>
    </div>
  );
}

function CheckoutInner({ mxeId, vesselName }: { mxeId: string; vesselName: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capRefusal, setCapRefusal] = useState<{ message: string; tier: SubscriptionTier } | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    setCapRefusal(null);

    // Order matters, and each step can stop the charge:
    //
    // 1. elements.submit() — validates the fields, and must be the first
    //    await so a wallet (Apple Pay, Google Pay) still has the user's
    //    click to open its sheet from.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Check your payment details and try again.");
      setSubmitting(false);
      return;
    }

    // 2. The shipping address. Before the charge, never after: an owner
    //    should not be able to pay for a badge that has nowhere to ship to.
    const addressError = await saveShippingAddress(elements, mxeId);
    if (addressError) {
      setError(addressError);
      setSubmitting(false);
      return;
    }

    // 3. The vessel cap, and only then the PaymentIntent. This is the
    //    check that used to run as the page loaded, where five open
    //    payment pages could each pass it. Here it runs a moment before
    //    the charge. A refusal means nothing exists in Stripe.
    let intent: Awaited<ReturnType<typeof createBadgeFeeIntent>>;
    try {
      intent = await createBadgeFeeIntent(mxeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      setSubmitting(false);
      return;
    }
    if ("error" in intent) {
      if (intent.code === "VESSEL_CAP_REACHED" && intent.tier) {
        setCapRefusal({ message: intent.error, tier: intent.tier });
      } else {
        setError(intent.error);
      }
      setSubmitting(false);
      return;
    }

    // 4. The charge.
    const processingUrl = `${window.location.origin}/dashboard/${encodeURIComponent(mxeId)}/payment/processing`;

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
      clientSecret: intent.clientSecret,
      redirect: "if_required",
      confirmParams: { return_url: processingUrl },
    });

    if (confirmError) {
      setError(confirmError.message ?? "Payment failed. Please try again.");
      setSubmitting(false);
      return;
    }

    if (paymentIntent && (paymentIntent.status === "succeeded" || paymentIntent.status === "processing")) {
      window.location.href = processingUrl;
      return;
    }

    setSubmitting(false);
  }

  return (
    <form onSubmit={onSubmit} className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <ShippingAddressSection />
      <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Payment details
      </p>
      <PaymentElement />
      <p className="mt-4 flex items-center gap-2 font-[family-name:var(--font-dm)] text-[11px] leading-relaxed text-[var(--text3)]">
        Payment processed securely by Stripe. Moxie never sees or stores your card details.
      </p>
      {error ? <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      {capRefusal ? (
        <div className="mt-4">
          <CapReachedNotice message={capRefusal.message} tier={capRefusal.tier} />
        </div>
      ) : null}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="mt-6 w-full rounded-lg bg-[var(--aqua-bright)] px-6 py-3.5 font-[family-name:var(--font-dm)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--navy-deep)] disabled:opacity-50"
      >
        {submitting ? "Processing…" : `Activate ${vesselName} →`}
      </button>
    </form>
  );
}
