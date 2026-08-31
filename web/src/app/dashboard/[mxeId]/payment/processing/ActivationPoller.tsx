"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const POLL_MS = 1500;
const TIMEOUT_MS = 45_000;

/**
 * Re-runs the server component on an interval until it sees the relevant
 * field flip — qr_status to 'active' for first-time activation, or
 * subscription_tier to 'full' for an upgrade (the page itself redirects
 * once it does). Purely a polling nudge — no client-side code here ever
 * writes either field.
 *
 * Stops after TIMEOUT_MS instead of spinning forever: if the webhook never
 * arrives (misconfigured `stripe listen`, a mismatched STRIPE_WEBHOOK_SECRET,
 * a genuine handler failure), the payment can be real while activation never
 * happens — the user needs to be told that plainly, not left staring at a
 * spinner indefinitely.
 */
export function ActivationPoller({
  mxeId,
  mode = "activate",
}: {
  mxeId: string;
  mode?: "activate" | "upgrade";
}) {
  const router = useRouter();
  const [timedOut, setTimedOut] = useState(false);

  useEffect(() => {
    if (timedOut) return;

    const interval = window.setInterval(() => router.refresh(), POLL_MS);
    const timeout = window.setTimeout(() => setTimedOut(true), TIMEOUT_MS);
    return () => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    };
  }, [router, timedOut]);

  if (timedOut) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--navy-deep)] px-6 text-center">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-[rgba(220,60,60,.15)]">
          <span className="text-2xl text-[#e57373]">!</span>
        </div>
        <p className="font-[family-name:var(--font-display)] text-2xl font-light italic text-white">
          {mode === "upgrade" ? "Still upgrading" : "Still not active"}
        </p>
        <p className="max-w-sm font-[family-name:var(--font-dm)] text-sm text-[rgba(255,255,255,.6)]">
          {mode === "upgrade"
            ? `${mxeId}'s upgrade hasn't completed after 45 seconds. If your card was charged, the payment went through but confirmation hasn't reached us yet — this doesn't need to be retried blindly. Check your Stripe Dashboard before paying again.`
            : `${mxeId} hasn't activated after 45 seconds. If your card was charged, the payment went through but confirmation hasn't reached us yet — this doesn't need to be retried blindly. Check your Stripe Dashboard before paying again.`}
        </p>
        <div className="mt-2 flex gap-3">
          <button
            type="button"
            onClick={() => {
              setTimedOut(false);
              router.refresh();
            }}
            className="rounded-lg border border-[rgba(255,255,255,.2)] px-4 py-2 font-[family-name:var(--font-dm)] text-sm text-white"
          >
            Check again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--navy-deep)] px-6 text-center">
      <div className="h-10 w-10 animate-spin rounded-full border-2 border-[rgba(255,255,255,.15)] border-t-[var(--aqua-bright)]" />
      <p className="font-[family-name:var(--font-display)] text-2xl font-light italic text-white">
        {mode === "upgrade" ? "Upgrading to Full Access" : `Activating ${mxeId}`}
      </p>
      <p className="max-w-xs font-[family-name:var(--font-dm)] text-sm text-[rgba(255,255,255,.6)]">
        This usually takes a few seconds — your payment is confirmed, we&apos;re finishing setup.
      </p>
    </div>
  );
}
