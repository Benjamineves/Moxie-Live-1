"use client";

import { useState, useTransition, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { upgradeToFullAccess } from "./actions";

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

/**
 * Basic → Full upgrade confirm screen. Unlike UpgradeForm (which offers a
 * genuine choice between two plans), there's only one direction here, so
 * this is "see the real total, then confirm" rather than a picker: the
 * prorated amount is computed for real (Stripe's own math, not a static
 * price tag) by upgradeToFullAccess() itself, so it's shown before the
 * user does anything that charges a card — same "full cost up front"
 * requirement as every other checkout here, just satisfied by making the
 * real Stripe object first instead of a separate non-mutating preview
 * call (see the action's own comment on why that's safe to do).
 */
export function UpgradeToFullForm({ publishableKey }: { publishableKey: string }) {
  const [status, setStatus] = useState<"idle" | "pending" | "ready" | "error">("idle");
  const [amount, setAmount] = useState<{ cents: number; currency: string } | null>(null);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [customerSessionClientSecret, setCustomerSessionClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function beginUpgrade() {
    setStatus("pending");
    setError(null);
    startTransition(async () => {
      try {
        const result = await upgradeToFullAccess();
        if ("error" in result) {
          setError(result.error);
          setStatus("error");
          return;
        }
        setAmount({ cents: result.amountCents, currency: result.currency });
        if (!result.clientSecret) {
          // $0 due — Stripe already finalized and paid the invoice with
          // no PaymentIntent to confirm. Nothing left for the user to do;
          // send them to the same poller every other flow here uses to
          // wait out the webhook.
          window.location.href = "/dashboard/upgrade/processing";
          return;
        }
        setClientSecret(result.clientSecret);
        setCustomerSessionClientSecret(result.customerSessionClientSecret);
        setStatus("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not start the upgrade. Please try again.");
        setStatus("error");
      }
    });
  }

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
            You&apos;re on Basic — upgrading switches your whole account to Full Access immediately. Your billing date
            doesn&apos;t change; we just credit the unused time left on your current Basic period against today&apos;s
            charge.
          </p>
        </header>

        {status === "idle" ? (
          <button
            type="button"
            onClick={beginUpgrade}
            className="w-full rounded-lg bg-[var(--aqua-bright)] px-6 py-3.5 font-[family-name:var(--font-dm)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--navy-deep)]"
          >
            See my upgrade total →
          </button>
        ) : null}

        {status === "pending" ? (
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">Calculating your total…</p>
        ) : null}

        {status === "error" && error ? (
          <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t start the upgrade: {error}
            </p>
            <button
              type="button"
              onClick={beginUpgrade}
              disabled={pending}
              className="mt-3 rounded-lg border border-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)] disabled:opacity-50"
            >
              {pending ? "Retrying…" : "Try again"}
            </button>
          </div>
        ) : null}

        {status === "ready" && amount ? (
          <>
            <div className="rounded-xl border border-[var(--gold)] bg-[var(--white)] p-5 shadow-[0_0_0_3px_var(--gold-dim)]">
              <div className="flex items-center justify-between gap-4">
                <span className="font-[family-name:var(--font-display)] text-lg italic text-[var(--navy)]">
                  Total due today
                </span>
                <span className="font-[family-name:var(--font-dm)] text-lg font-semibold text-[var(--navy)]">
                  {formatAmount(amount.cents, amount.currency)}
                </span>
              </div>
              <p className="mt-2 font-[family-name:var(--font-dm)] text-[11px] leading-relaxed text-[var(--text3)]">
                This is the Full Access price for the rest of your current billing period, minus a credit for the
                unused time left on Basic — Stripe calculates the exact split, so this may not look like a round
                number. Your renewal date doesn&apos;t change.
              </p>
            </div>
            <div className="mt-6">
              {clientSecret ? (
                <Elements
                  key={clientSecret}
                  stripe={stripe}
                  options={
                    customerSessionClientSecret ? { clientSecret, customerSessionClientSecret } : { clientSecret }
                  }
                >
                  <CheckoutInner />
                </Elements>
              ) : null}
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

/**
 * If the Customer Session came through, PaymentElement shows the saved
 * default payment method pre-selected (one-click confirm) with the
 * option to pick a different saved card or add a new one — separate
 * from whatever card the badge fee or other charges used. If there's no
 * saved card at all (or the session failed to create — see the action's
 * own try/catch around it), PaymentElement falls back to its normal
 * "enter a new card" form on its own; no separate empty-state handling
 * needed here.
 */
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
      <p className="mb-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Payment details
      </p>
      <p className="mb-4 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
        Your card on file is selected below — switch to a different one if you&apos;d rather this charge land
        elsewhere.
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
        {submitting ? "Processing…" : "Confirm upgrade →"}
      </button>
    </form>
  );
}
