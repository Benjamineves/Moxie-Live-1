"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { openBillingPortal } from "@/lib/owner-actions";
import type { BillingSummary } from "@/lib/billing-service";

const PAYMENT_TYPE_LABELS: Record<string, string> = {
  badge_fee: "Badge fee",
  subscription: "Plan subscription",
  transfer_fee: "Ownership transfer",
};

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-[rgba(23,195,178,.15)] text-[var(--aqua-bright)] border-[rgba(23,195,178,.3)]" },
  past_due: { label: "Past due", className: "bg-[var(--amber-bg)] text-[var(--amber-fg)] border-transparent" },
  canceled: { label: "Canceled", className: "bg-[var(--red-bg)] text-[var(--red-fg)] border-transparent" },
  none: { label: "No subscription", className: "bg-[rgba(255,255,255,.08)] text-[rgba(255,255,255,.5)] border-transparent" },
};

/**
 * Account-level bottom sheet, ported from
 * docs/design/moxie_digital_profile_owner.html's #account-overlay
 * (.fleet-panel pattern reused). Trigger lives in VesselOwnerProfile's
 * header rather than a full bottom nav — see build spec discussion; no
 * Profile/My Fleet/Docs tabs exist in the app yet, so this only ports the
 * one entry point that was actually asked for.
 */
export function AccountBillingPanel({ billing }: { billing: BillingSummary }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onManageBilling() {
    setError(null);
    startTransition(async () => {
      const result = await openBillingPortal();
      if (result?.error) setError(result.error);
      // On success this never returns — openBillingPortal() redirects.
    });
  }

  const badge = STATUS_BADGE[billing.subscriptionStatus ?? "none"] ?? STATUS_BADGE.none;
  // A real Stripe subscription exists in either of these states — 'active'
  // or 'past_due' (payment failing but not yet canceled) — so Manage
  // Billing (the Stripe Portal) is the right surface for both. 'none' and
  // 'canceled' have no subscription to manage; those get the plan picker
  // instead. Deliberately not gated on tier any more — Basic is a real
  // subscription now too, not a free fallback.
  const hasManageableSubscription = billing.subscriptionStatus === "active" || billing.subscriptionStatus === "past_due";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)] transition hover:text-[var(--gold)]"
      >
        Account
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[300] bg-[rgba(7,16,32,.85)] backdrop-blur-sm"
          onClick={() => setOpen(false)}
        >
          <div
            className="absolute bottom-0 left-0 right-0 mx-auto max-w-lg rounded-t-[20px] bg-[var(--navy2)] pb-8"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mx-auto mb-5 mt-3 h-1 w-9 rounded-full bg-[rgba(255,255,255,.2)]" />
            <p className="mb-3.5 px-5 font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.18em] text-[rgba(255,255,255,.4)]">
              Account &amp; Billing
            </p>

            <div className="px-5">
              <div className="flex items-center justify-between border-b border-[rgba(255,255,255,.08)] py-3.5">
                <div>
                  <p className="font-[family-name:var(--font-display)] text-lg italic text-white">
                    {billing.subscriptionTier === "full" ? "Full Access" : "Basic"}
                  </p>
                  {hasManageableSubscription ? (
                    <p className="mt-0.5 font-[family-name:var(--font-dm)] text-[11px] text-[rgba(255,255,255,.4)]">
                      Renews annually
                    </p>
                  ) : null}
                </div>
                <span
                  className={`rounded-full border px-2.5 py-1 font-[family-name:var(--font-dm)] text-[8px] font-semibold uppercase tracking-[0.14em] ${badge.className}`}
                >
                  {badge.label}
                </span>
              </div>

              {billing.payments.length > 0 ? (
                <div className="border-b border-[rgba(255,255,255,.08)] py-4">
                  <p className="mb-2.5 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.16em] text-[rgba(255,255,255,.3)]">
                    Payment history
                  </p>
                  {billing.payments.map((p, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between py-1.5 font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.6)]"
                    >
                      <span>
                        {PAYMENT_TYPE_LABELS[p.paymentType] ?? p.paymentType} — {p.vesselName}
                      </span>
                      <span className="capitalize">{p.status}</span>
                    </div>
                  ))}
                </div>
              ) : null}

              <div className="py-4">
                {hasManageableSubscription ? (
                  <>
                    <button
                      type="button"
                      onClick={onManageBilling}
                      disabled={pending}
                      className="w-full border border-[rgba(201,168,76,.3)] bg-transparent px-3 py-3 font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--gold)] disabled:opacity-50"
                    >
                      {pending ? "Opening…" : "Manage billing"}
                    </button>
                    {error ? (
                      <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p>
                    ) : null}
                  </>
                ) : (
                  <Link
                    href="/dashboard/upgrade"
                    className="block w-full bg-[var(--aqua-bright)] px-3 py-3 text-center font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--navy)]"
                  >
                    Choose your plan →
                  </Link>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
