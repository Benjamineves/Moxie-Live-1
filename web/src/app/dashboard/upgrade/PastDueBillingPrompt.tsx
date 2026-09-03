"use client";

import { useState, useTransition } from "react";
import { openBillingPortal } from "@/lib/owner-actions";

/**
 * subscription_status='past_due' isn't "pick a new plan" — the
 * subscription already exists, it's just delinquent. The fix is
 * updating the payment method (and retrying the failed invoice), which
 * is exactly what Stripe's Billing Portal does — the same action
 * AccountBillingPanel's "Manage billing" button already triggers.
 * Reached from /dashboard/upgrade whenever subscription_status is
 * 'past_due', regardless of tier — this used to fall through to "already
 * on Full, nothing to do" and bounce back to /dashboard with no way to
 * actually fix the payment.
 */
export function PastDueBillingPrompt() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onManageBilling() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal();
      if (result?.error) setError(result.error);
      // On success this never returns — openBillingPortal() redirects.
    });
  }

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-8">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Account &amp; Billing
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            Payment <em className="text-[var(--gold)] not-italic">past due.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Your last payment didn&apos;t go through. Update your payment method to bring your account current — your
            vessels&apos; document access, sharing, and editing restore automatically once it&apos;s paid.
          </p>
        </header>

        <button
          type="button"
          onClick={onManageBilling}
          disabled={pending}
          className="w-full rounded-lg bg-[var(--aqua-bright)] px-6 py-3.5 font-[family-name:var(--font-dm)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--navy-deep)] disabled:opacity-50"
        >
          {pending ? "Opening…" : "Update payment method →"}
        </button>
        {error ? <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      </main>
    </div>
  );
}
