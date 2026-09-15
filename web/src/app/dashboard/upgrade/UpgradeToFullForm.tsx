"use client";

import { useState, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { upgradeToFullAccess } from "./actions";
import { IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES } from "@/lib/stripe/payment-methods";

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

function formatAmount(cents: number, currency: string) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(cents / 100);
}

type Props = {
  publishableKey: string;
  /** The prorated total, quoted by the page from invoices.createPreview (a read). */
  amountCents: number;
  currency: string;
  /** The moment the quote was computed as of. Sent back at the Pay click, which re-quotes with it. */
  prorationDate: number;
  /** Lists the owner's saved cards in the Payment Element. Null when they have none, or it couldn't be made. */
  customerSessionClientSecret: string | null;
};

/**
 * Basic → Full upgrade confirm screen. The total is real (Stripe's proration
 * math, quoted on load) and nothing exists in Stripe until the Pay click:
 * Elements mounts in deferred mode, and upgradeToFullAccess creates the
 * invoice only after the payment details validate. The subscription itself
 * is not changed until the webhook sees the invoice paid. An owner with a
 * saved card sees it listed and can pay with it, or enter another.
 *
 * It used to change the subscription and create the invoice when the owner
 * asked to see the total — leaving them on the Full price in Stripe if they
 * then walked away.
 */
export function UpgradeToFullForm({ publishableKey, amountCents, currency, prorationDate, customerSessionClientSecret }: Props) {
  const stripe = getStripeJs(publishableKey);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Account &amp; Billing · Upgrade
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            Full <em className="text-[var(--gold-deep)] not-italic">Access.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            You&apos;re on Basic — upgrading switches your whole account to Full Access once this payment clears. Your
            billing date doesn&apos;t change; we credit the unused time left on your current Basic period against
            today&apos;s charge.
          </p>
        </header>

        <div className="rounded-xl border border-[var(--gold)] bg-[var(--white)] p-5 shadow-[0_0_0_3px_var(--gold-dim)]">
          <div className="flex items-center justify-between gap-4">
            <span className="font-[family-name:var(--font-display)] text-lg italic text-[var(--navy)]">Total due today</span>
            <span className="font-[family-name:var(--font-dm)] text-lg font-semibold text-[var(--navy)]">
              {formatAmount(amountCents, currency)}
            </span>
          </div>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-[11px] leading-relaxed text-[var(--text3)]">
            This is the Full Access price for the rest of your current billing period, minus a credit for the unused
            time left on Basic — Stripe calculates the exact split, so this may not look like a round number. Your
            renewal date doesn&apos;t change.
          </p>
        </div>

        <div className="mt-6">
          {/* Deferred mode: amount and currency, no PaymentIntent. Loading
              this page creates nothing in Stripe. */}
          <Elements
            stripe={stripe}
            options={{
              mode: "payment",
              amount: amountCents,
              currency,
              // Must match the invoice's payment_settings — see
              // lib/stripe/payment-methods.ts.
              paymentMethodTypes: [...IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES],
              // Saved cards, listed by a Customer Session — see
              // createSavedCardSession. No setup_future_usage option: the upgrade
              // invoice's intent has none, and the session can't add one
              // (saving is disabled on it).
              ...(customerSessionClientSecret ? { customerSessionClientSecret } : {}),
            }}
          >
            <CheckoutInner amountCents={amountCents} prorationDate={prorationDate} />
          </Elements>
        </div>
      </main>
    </div>
  );
}

function CheckoutInner({ amountCents, prorationDate }: { amountCents: number; prorationDate: number }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReload, setNeedsReload] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);
    setNeedsReload(false);

    // 1: validate. First await, so a wallet (Apple Pay, Google Pay) still
    //    has the user's click to open its sheet from.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Check your payment details and try again.");
      setSubmitting(false);
      return;
    }

    // 2: re-quote with the same proration date, then the invoice.
    let intent: Awaited<ReturnType<typeof upgradeToFullAccess>>;
    try {
      intent = await upgradeToFullAccess({ expectedAmountCents: amountCents, prorationDate });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start the upgrade. Please try again.");
      setSubmitting(false);
      return;
    }
    if ("error" in intent) {
      setError(intent.error);
      setNeedsReload(intent.code === "AMOUNT_CHANGED" || intent.code === "STALE_QUOTE");
      setSubmitting(false);
      return;
    }

    // 3: the charge.
    const processingUrl = `${window.location.origin}/dashboard/upgrade/processing?tier=full`;

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
      <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Payment details
      </p>
      {/* Link off: it offers bank-funded payments that settle later,
          which the card-only invoice would refuse anyway. */}
      <PaymentElement options={{ wallets: { link: "never" } }} />
      <p className="mt-4 flex items-center gap-2 font-[family-name:var(--font-dm)] text-[11px] leading-relaxed text-[var(--text3)]">
        Payment processed securely by Stripe. Moxie never sees or stores your card details.
      </p>
      {error ? <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      {needsReload ? (
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-3 rounded-lg border border-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)]"
        >
          Reload total
        </button>
      ) : null}
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
