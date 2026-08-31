"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";
import { loadStripe, type Stripe as StripeJs } from "@stripe/stripe-js";
import { Elements, PaymentElement, useElements, useStripe } from "@stripe/react-stripe-js";
import { createIntentForTier, type Tier } from "./actions";

type Props = {
  mxeId: string;
  vesselName: string;
  vesselTag: string;
  publishableKey: string;
  /** Active vessel upgrading Basic -> Full — Basic has nothing left to
   *  offer here, so it's not shown (createIntentForTier also independently
   *  refuses it server-side; this just avoids presenting a dead-end option
   *  in the first place). */
  isUpgrade: boolean;
};

type TierCopy = {
  value: Tier;
  name: string;
  price: string;
  cadence: string;
  features: string[];
  note?: string;
  recommended?: boolean;
};

// Placeholder amounts — build spec §9 item 9 treats exact pricing as a
// business decision to plug in later; these just need to match whatever
// STRIPE_PRICE_ID_BASIC / STRIPE_PRICE_ID_FULL are configured to in Stripe.
const TIERS: TierCopy[] = [
  {
    value: "basic",
    name: "Basic",
    price: "$49",
    cadence: "one-time",
    features: [
      "Weatherproof QR badge, printed & shipped",
      "Live public + owner profile",
      "CA Boater Card included — always, on every plan",
      "+1 additional document, 1 photo",
      "In-app status reminders — no email alerts",
    ],
  },
  {
    value: "full",
    name: "Full Access",
    price: "$12.42/mo",
    cadence: "billed annually",
    recommended: true,
    features: [
      "Everything in Basic, plus:",
      "Unlimited documents & photos",
      "Email reminders before insurance/registration lapse",
      "Priority badge production",
    ],
    note: "Includes the sticker at no extra charge — most owners find this the better deal over Basic's one-time fee.",
  },
];

let stripePromise: Promise<StripeJs | null> | null = null;
function getStripeJs(publishableKey: string) {
  if (!stripePromise) stripePromise = loadStripe(publishableKey);
  return stripePromise;
}

export function PaymentForm({ mxeId, vesselName, vesselTag, publishableKey, isUpgrade }: Props) {
  const visibleTiers = isUpgrade ? TIERS.filter((t) => t.value !== "basic") : TIERS;
  const [tier, setTier] = useState<Tier>("full");
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    setClientSecret(null);
    setError(null);

    // Debounced rather than firing immediately: createIntentForTier is a
    // server action that creates a real Stripe PaymentIntent or
    // Subscription — it can't be aborted mid-flight once called (unlike a
    // plain fetch), so the only way to avoid an abandoned Stripe object per
    // click is to not call it until the selection settles. `cancelled`
    // additionally guards against acting on a stale response if the tier
    // changes again while a call from a previous selection is still
    // in-flight (the debounce alone can't prevent that race, only reduce
    // how often it happens).
    let cancelled = false;
    const debounceId = window.setTimeout(() => {
      startTransition(async () => {
        const result = await createIntentForTier(mxeId, tier);
        if (cancelled) return;
        if ("error" in result) {
          setError(result.error);
          return;
        }
        setClientSecret(result.clientSecret);
      });
    }, 500);

    return () => {
      cancelled = true;
      window.clearTimeout(debounceId);
    };
    // startTransition is stable; re-run only when the vessel or chosen tier changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mxeId, tier]);

  const stripe = getStripeJs(publishableKey);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Final step · Activate
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            One boat, <em className="text-[var(--gold)] not-italic">one identity.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Your sticker prints and ships the moment this clears. {vesselName}&apos;s profile goes live at the same
            time — anyone who scans it from then on sees a real, active vessel identity.
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{vesselTag}</p>
        </header>

        <div className="grid gap-3">
          {visibleTiers.map((t) => (
            <button
              key={t.value}
              type="button"
              onClick={() => setTier(t.value)}
              className={`relative rounded-xl border p-5 text-left transition ${
                tier === t.value
                  ? "border-[var(--gold)] bg-[var(--white)] shadow-[0_0_0_3px_var(--gold-dim)]"
                  : "border-[var(--divider)] bg-[var(--white)] hover:border-[var(--gold-line)]"
              }`}
            >
              {t.recommended ? (
                <span className="absolute -top-2.5 left-5 rounded-full bg-[var(--navy)] px-2.5 py-0.5 font-[family-name:var(--font-dm)] text-[9px] font-semibold uppercase tracking-[0.14em] text-[var(--gold)]">
                  Recommended
                </span>
              ) : null}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-2.5">
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px] ${
                      tier === t.value ? "border-[var(--gold)]" : "border-[var(--divider)]"
                    }`}
                  >
                    {tier === t.value ? <span className="h-[9px] w-[9px] rounded-full bg-[var(--gold)]" /> : null}
                  </span>
                  <span className="font-[family-name:var(--font-display)] text-xl italic text-[var(--navy)]">
                    {t.name}
                  </span>
                </div>
                <div className="text-right">
                  <div className="font-[family-name:var(--font-dm)] text-xl font-semibold text-[var(--navy)]">
                    {t.price}
                  </div>
                  <div className="font-[family-name:var(--font-dm)] text-[10px] uppercase tracking-[0.08em] text-[var(--text3)]">
                    {t.cadence}
                  </div>
                </div>
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 pl-7">
                {t.features.map((f) => (
                  <li
                    key={f}
                    className="font-[family-name:var(--font-dm)] text-[13px] leading-relaxed text-[var(--text2)]"
                  >
                    — {f}
                  </li>
                ))}
              </ul>
              {t.note ? (
                <p className="mt-2.5 pl-7 font-[family-name:var(--font-dm)] text-[11px] italic leading-relaxed text-[var(--text3)]">
                  {t.note}
                </p>
              ) : null}
            </button>
          ))}
        </div>

        <div className="mt-8">
          {error ? (
            <p className="mb-4 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
          ) : null}
          {clientSecret ? (
            <Elements key={clientSecret} stripe={stripe} options={{ clientSecret }}>
              <CheckoutInner
                mxeId={mxeId}
                vesselName={vesselName}
                isUpgrade={isUpgrade}
              />
            </Elements>
          ) : error ? null : (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
              {pending ? "Preparing payment…" : "Select a plan to continue."}
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

function CheckoutInner({
  mxeId,
  vesselName,
  isUpgrade,
}: {
  mxeId: string;
  vesselName: string;
  isUpgrade: boolean;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;
    setSubmitting(true);
    setError(null);

    const processingUrl = `${window.location.origin}/dashboard/${encodeURIComponent(mxeId)}/payment/processing${isUpgrade ? "?upgrade=1" : ""}`;

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
        {submitting ? "Processing…" : `Activate ${vesselName} →`}
      </button>
    </form>
  );
}
