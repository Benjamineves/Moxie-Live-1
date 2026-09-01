"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createFullAccessUpgradeIntent } from "./actions";

// Placeholder amount — build spec §9 item 9 treats exact pricing as a
// business decision to plug in later; this just needs to match whatever
// STRIPE_PRICE_ID_FULL is configured to in Stripe.
const FULL_ACCESS_COPY = {
  price: "$12.42/mo",
  cadence: "billed annually",
  features: [
    "Unlimited documents & photos, every vessel",
    "Sharing, ownership transfer, and archiving",
    "Email reminders before insurance/registration lapse",
    "Priority badge production",
  ],
  note: "Covers your whole fleet — up to 5 vessels on one account, one subscription. Vessel badge fees are still paid per vessel, separately.",
};

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function UpgradeForm({ publishableKey }: { publishableKey: string }) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    startTransition(async () => {
      // createFullAccessUpgradeIntent catches its own Stripe/DB errors and
      // returns {error} rather than throwing — this try/catch is a second
      // layer in case something still escapes. Without it, an uncaught
      // rejection here left the UI stuck on "Loading…" forever with no
      // visible error (see the badge-fee checkout page for the confirmed
      // live case of this exact failure mode).
      try {
        const result = await createFullAccessUpgradeIntent();
        if (cancelled) return;
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setClientSecret(result.clientSecret);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const stripe = getStripeJs(publishableKey);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Account &amp; Billing · Upgrade
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            Full <em className="text-[var(--gold)] not-italic">Access.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            One subscription for your whole account — every vessel you register from here on is covered
            automatically, no separate upgrade per boat.
          </p>
        </header>

        <div className="rounded-xl border border-[var(--gold)] bg-[var(--white)] p-5 shadow-[0_0_0_3px_var(--gold-dim)]">
          <div className="flex items-start justify-between gap-4">
            <span className="font-[family-name:var(--font-display)] text-xl italic text-[var(--navy)]">
              Full Access
            </span>
            <div className="text-right">
              <div className="font-[family-name:var(--font-dm)] text-xl font-semibold text-[var(--navy)]">
                {FULL_ACCESS_COPY.price}
              </div>
              <div className="font-[family-name:var(--font-dm)] text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
                {FULL_ACCESS_COPY.cadence}
              </div>
            </div>
          </div>
          <ul className="mt-3 flex flex-col gap-1.5">
            {FULL_ACCESS_COPY.features.map((f) => (
              <li key={f} className="font-[family-name:var(--font-dm)] text-[13px] leading-relaxed text-[var(--text2)]">
                — {f}
              </li>
            ))}
          </ul>
          <p className="mt-2.5 font-[family-name:var(--font-dm)] text-[11px] italic leading-relaxed text-[var(--text3)]">
            {FULL_ACCESS_COPY.note}
          </p>
        </div>

        <div className="mt-8">
          {error ? (
            <p className="mb-4 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
          ) : null}
          {clientSecret ? (
            <Elements key={clientSecret} stripe={stripe} options={{ clientSecret }}>
              <CheckoutInner />
            </Elements>
          ) : error ? null : (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
              {pending ? "Preparing payment…" : "Loading…"}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function CheckoutInner() {
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
        {submitting ? "Processing…" : "Upgrade to Full Access →"}
      </button>
    </form>
  );
}
