"use client";

import { useState, useTransition, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createTransferFeeIntent } from "./actions";
import { cancelOwnershipTransfer } from "@/lib/owner-actions";
import { CancelTransferDialog } from "@/components/vessel-edit/CancelTransferDialog";
import { cancelButtonClass, dangerButtonClass } from "@/components/vessel-edit/formStyles";
import { TRANSFER_FEE_AMOUNT_USD } from "@/lib/tier-config";
import type { TransferFeeAmount } from "@/lib/stripe/checkout-amounts";

type Props = {
  transferId: string;
  mxeId: string;
  buyerEmail: string;
  sellerTier: "basic" | "full";
  publishableKey: string;
  /** The real Stripe Price for this seller's fee. Elements mounts with it before any intent exists. */
  amount: TransferFeeAmount;
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

export function TransferPaymentForm({ transferId, mxeId, buyerEmail, sellerTier, publishableKey, amount }: Props) {
  // True from the Pay click until the payment has been confirmed or has
  // failed. While it is, the cancel button is disabled: cancelling in the
  // seconds between the intent being created and the card being charged is
  // exactly how a seller pays for a transfer that no longer exists.
  const [paying, setPaying] = useState(false);

  // Cancellation gets its own pending flag rather than sharing the
  // checkout one — a seller cancelling should not see the payment form
  // flicker into a loading state. The two must NOT overlap in the other
  // direction, though: `paying` above disables cancel mid-payment.
  const router = useRouter();
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [cancelPending, startCancel] = useTransition();

  function onCancelTransfer() {
    setCancelError(null);
    startCancel(async () => {
      const result = await cancelOwnershipTransfer(transferId);
      if (result.error) {
        setCancelError(result.error);
        return;
      }
      // Back to the vessel, which is where a seller who just called off
      // a sale actually wants to be — and this page redirects away on
      // its own now the transfer is no longer awaiting_payment.
      setConfirmingCancel(false);
      router.replace(`/${encodeURIComponent(mxeId)}?role=owner`);
    });
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
            {buyerEmail} <em className="text-[var(--gold-deep)] not-italic">accepted.</em>
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
          {/* Deferred mode: amount and currency, no PaymentIntent. Loading
              this page creates nothing in Stripe; the Pay click does, after
              checking the transfer is still awaiting payment.

              WHAT THIS DOES NOT CLOSE. Some payment methods the Payment
              Element offers (US bank debit is the clear one) confirm as
              "processing" and settle days later. The transfer stays
              awaiting_payment until the webhook hears it succeeded, and
              the seller can still cancel from the vessel page in that
              gap — then the settled payment has no transfer to complete.
              Closing that needs either cancellation to check Stripe for a
              processing payment first, or this fee to accept only methods
              that settle immediately. Both are decisions, not done here. */}
          <Elements stripe={stripe} options={{ mode: "payment", amount: amount.feeCents, currency: amount.currency }}>
            <CheckoutInner transferId={transferId} expectedAmountCents={amount.feeCents} onPayingChange={setPaying} />
          </Elements>
        </div>

        {/* THE WAY OUT.
            This screen had none — no back, no cancel, nothing. In a
            standalone PWA there is no browser chrome to escape with
            either (pwa spec §3b), so a seller having second thoughts
            about a sale was stuck on a payment form.

            Two doors, deliberately far apart in weight, because they are
            not the same decision. Leaving changes nothing and the
            transfer stays live; cancelling ends the sale and tells the
            buyer. The neutral one is a plain link, the destructive one
            is outlined red and asks first. */}
        <div className="mt-10 border-t border-[var(--divider)] pt-6">
          <div className="flex flex-wrap items-center gap-3">
            <Link href={`/${encodeURIComponent(mxeId)}?role=owner`} className={cancelButtonClass}>
              Back to {mxeId}
            </Link>
            <button
              type="button"
              onClick={() => setConfirmingCancel(true)}
              disabled={cancelPending || paying}
              className={dangerButtonClass}
            >
              {cancelPending ? "Cancelling…" : "Cancel this transfer"}
            </button>
          </div>
          <p className="mt-2.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            Going back leaves the transfer open — you can pay later, and {buyerEmail} keeps waiting. Cancelling ends it
            and tells them.
          </p>
          {cancelError ? (
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{cancelError}</p>
          ) : null}
        </div>

        <CancelTransferDialog
          open={confirmingCancel}
          buyerEmail={buyerEmail}
          pending={cancelPending}
          onConfirm={onCancelTransfer}
          onDismiss={() => setConfirmingCancel(false)}
        />
      </main>
    </div>
  );
}

function CheckoutInner({
  transferId,
  expectedAmountCents,
  onPayingChange,
}: {
  transferId: string;
  expectedAmountCents: number;
  onPayingChange: (paying: boolean) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmittingState] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setSubmitting(value: boolean) {
    setSubmittingState(value);
    onPayingChange(value);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    // 1. Validate, as the first await, so a wallet keeps the click.
    const { error: submitError } = await elements.submit();
    if (submitError) {
      setError(submitError.message ?? "Check your payment details and try again.");
      setSubmitting(false);
      return;
    }

    // 2. Only now create the intent — which refuses, before touching
    //    Stripe, if the transfer was cancelled since the page loaded.
    let intent: Awaited<ReturnType<typeof createTransferFeeIntent>>;
    try {
      intent = await createTransferFeeIntent(transferId, expectedAmountCents);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start checkout. Please try again.");
      setSubmitting(false);
      return;
    }
    if ("error" in intent) {
      setError(intent.error);
      setSubmitting(false);
      return;
    }

    // 3. The charge.
    const processingUrl = `${window.location.origin}/dashboard/transfer/${encodeURIComponent(transferId)}/payment/processing`;

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
