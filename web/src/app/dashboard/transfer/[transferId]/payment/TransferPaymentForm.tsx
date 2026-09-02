"use client";

import { useCallback, useEffect, useState, useTransition, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createTransferFeeIntent } from "./actions";
import { TRANSFER_FEE_AMOUNT_USD } from "@/lib/tier-config";

type Props = {
  transferId: string;
  mxeId: string;
  buyerEmail: string;
  sellerTier: "basic" | "full";
  publishableKey: string;
};

// Prices read from lib/tier-config.ts, the single numeric source — needs
// to match whatever STRIPE_PRICE_ID_TRANSFER_BASIC/_FULL are configured
// to in Stripe.
const TRANSFER_FEE_PRICE: Record<"basic" | "full", string> = {
  basic: `$${TRANSFER_FEE_AMOUNT_USD.basic}`,
  full: `$${TRANSFER_FEE_AMOUNT_USD.full}`,
};

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function TransferPaymentForm({ transferId, mxeId, buyerEmail, sellerTier, publishableKey }: Props) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const attempt = useCallback(
    (onCancelled: () => boolean) => {
      startTransition(async () => {
        try {
          const result = await createTransferFeeIntent(transferId);
          if (onCancelled()) return;
          if ("error" in result) {
            setError(result.error);
            return;
          }
          setClientSecret(result.clientSecret);
        } catch (err) {
          if (onCancelled()) return;
          setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
        }
      });
    },
    [transferId],
  );

  useEffect(() => {
    let cancelled = false;
    attempt(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  function retry() {
    setError(null);
    setClientSecret(null);
    attempt(() => false);
  }

  const stripe = getStripeJs(publishableKey);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Final step · Transfer fee
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            {buyerEmail} <em className="text-[var(--gold)] not-italic">accepted.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Ownership of {mxeId} moves to their account the moment this clears. Nothing changes until then.
          </p>
        </header>

        <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <span className="font-[family-name:var(--font-display)] text-xl italic text-[var(--navy)]">
              Transfer fee
            </span>
            <div className="text-right">
              <div className="font-[family-name:var(--font-dm)] text-xl font-semibold text-[var(--navy)]">
                {TRANSFER_FEE_PRICE[sellerTier]}
              </div>
              <div className="font-[family-name:var(--font-dm)] text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
                one-time
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          {error ? (
            <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
                Couldn&apos;t start checkout: {error}
              </p>
              <button
                type="button"
                onClick={retry}
                disabled={pending}
                className="mt-3 rounded-lg border border-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)] disabled:opacity-50"
              >
                {pending ? "Retrying…" : "Try again"}
              </button>
            </div>
          ) : null}
          {clientSecret ? (
            <Elements key={clientSecret} stripe={stripe} options={{ clientSecret }}>
              <CheckoutInner transferId={transferId} />
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

function CheckoutInner({ transferId }: { transferId: string }) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const processingUrl = `${window.location.origin}/dashboard/transfer/${encodeURIComponent(transferId)}/payment/processing`;

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
        {submitting ? "Processing…" : "Complete transfer →"}
      </button>
    </form>
  );
}
