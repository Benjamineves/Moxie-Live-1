"use client";

import { useCallback, useState, useTransition, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createPlanSubscriptionIntent } from "./actions";
import { SUBSCRIPTION_AMOUNT_USD, type SubscriptionTier } from "@/lib/tier-config";

// Prices read from lib/tier-config.ts, the single numeric source — needs
// to match whatever STRIPE_PRICE_ID_BASIC_SUBSCRIPTION /
// STRIPE_PRICE_ID_FULL are configured to in Stripe. Only feature copy
// lives here.
const PLAN_OPTIONS: {
  tier: SubscriptionTier;
  label: string;
  price: number;
  features: string[];
}[] = [
  {
    tier: "basic",
    label: "Basic",
    price: SUBSCRIPTION_AMOUNT_USD.basic,
    features: ["2 vessels", "3 documents per vessel", "Trusted Contact sharing"],
  },
  {
    tier: "full",
    label: "Full Access",
    price: SUBSCRIPTION_AMOUNT_USD.full,
    features: [
      "5 vessels",
      "Unlimited documents (500MB storage)",
      "Trusted Contact sharing",
      "Email reminders before insurance/registration lapse",
      "Priority badge production",
    ],
  },
];

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function UpgradeForm({ publishableKey }: { publishableKey: string }) {
  const [selectedTier, setSelectedTier] = useState<SubscriptionTier | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const choosePlan = useCallback((tier: SubscriptionTier) => {
    setSelectedTier(tier);
    setClientSecret(null);
    setError(null);
    startTransition(async () => {
      try {
        const result = await createPlanSubscriptionIntent(tier);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setClientSecret(result.clientSecret);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      }
    });
  }, []);

  function changePlan() {
    setSelectedTier(null);
    setClientSecret(null);
    setError(null);
  }

  const stripe = getStripeJs(publishableKey);
  const plan = PLAN_OPTIONS.find((p) => p.tier === selectedTier);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Account &amp; Billing · Choose your plan
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            Pick your <em className="text-[var(--gold)] not-italic">plan.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            One subscription for your whole account — every vessel you register from here on is covered
            automatically, no separate plan per boat. Vessel badge fees are still paid per vessel, separately.
          </p>
        </header>

        {!selectedTier ? (
          <div className="flex flex-col gap-3">
            {PLAN_OPTIONS.map((p) => (
              <button
                key={p.tier}
                type="button"
                onClick={() => choosePlan(p.tier)}
                className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 text-left shadow-sm transition hover:border-[var(--gold)]"
              >
                <div className="flex items-start justify-between gap-4">
                  <span className="font-[family-name:var(--font-display)] text-xl italic text-[var(--navy)]">
                    {p.label}
                  </span>
                  <div className="text-right">
                    <div className="font-[family-name:var(--font-dm)] text-xl font-semibold text-[var(--navy)]">
                      ${p.price}/yr
                    </div>
                  </div>
                </div>
                <ul className="mt-3 flex flex-col gap-1.5">
                  {p.features.map((f) => (
                    <li key={f} className="font-[family-name:var(--font-dm)] text-[13px] leading-relaxed text-[var(--text2)]">
                      — {f}
                    </li>
                  ))}
                </ul>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-[var(--gold)] bg-[var(--white)] p-5 shadow-[0_0_0_3px_var(--gold-dim)]">
            <div className="flex items-center justify-between gap-4">
              <span className="font-[family-name:var(--font-display)] text-lg italic text-[var(--navy)]">
                {plan?.label} plan
              </span>
              <span className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
                ${plan?.price}/yr
              </span>
            </div>
            <button
              type="button"
              onClick={changePlan}
              disabled={pending}
              className="mt-3 font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--text3)] underline underline-offset-2 disabled:opacity-50"
            >
              Change plan
            </button>
          </div>
        )}

        {selectedTier ? (
          <div className="mt-6">
            {error ? (
              <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
                <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
                  Couldn&apos;t start checkout: {error}
                </p>
                <button
                  type="button"
                  onClick={() => choosePlan(selectedTier)}
                  disabled={pending}
                  className="mt-3 rounded-lg border border-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)] disabled:opacity-50"
                >
                  {pending ? "Retrying…" : "Try again"}
                </button>
              </div>
            ) : null}
            {clientSecret ? (
              <Elements key={clientSecret} stripe={stripe} options={{ clientSecret }}>
                <CheckoutInner planLabel={plan?.label ?? "plan"} />
              </Elements>
            ) : error ? null : (
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
                {pending ? "Preparing payment…" : "Loading…"}
              </p>
            )}
          </div>
        ) : null}
      </main>
    </div>
  );
}

function CheckoutInner({ planLabel }: { planLabel: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const processingUrl = `${window.location.origin}/dashboard/upgrade/processing`;

    const { error: confirmError, paymentIntent } = await stripe.confirmPayment({
      elements,
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
      <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Payment details
      </p>
      <PaymentElement />
      <p className="mt-4 flex items-center gap-2 font-[family-name:var(--font-dm)] text-[11px] leading-relaxed text-[var(--text3)]">
        Payment processed securely by Stripe. Moxie never sees or stores your card details.
      </p>
      {error ? <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="mt-6 w-full rounded-lg bg-[var(--aqua-bright)] px-6 py-3.5 font-[family-name:var(--font-dm)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--navy-deep)] disabled:opacity-50"
      >
        {submitting ? "Processing…" : `Subscribe to ${planLabel} →`}
      </button>
    </form>
  );
}
