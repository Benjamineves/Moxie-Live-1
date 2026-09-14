"use client";

import Link from "next/link";
import { VESSEL_LIMIT, type SubscriptionTier } from "@/lib/tier-config";

/**
 * Shown when a checkout action refused at the Pay click because the plan
 * has no room for another active vessel. By the time this renders, nothing
 * has been sent to Stripe — no intent, no subscription — so the first
 * thing it has to say is that no money moved.
 *
 * Shared by both checkout forms so the two refusals cannot drift into
 * saying different things.
 */
export function CapReachedNotice({
  message,
  tier,
  onChooseFull,
}: {
  /** From evaluateVesselCap — already states the limit and that nothing was charged. */
  message: string;
  /** The plan the refusal was measured against. */
  tier: SubscriptionTier;
  /**
   * Signup only: switch the pending plan choice to Full Access in place.
   * An existing Basic subscriber upgrades on its own page instead.
   */
  onChooseFull?: () => void;
}) {
  const canGoFull = tier === "basic";

  return (
    <div className="rounded-xl border border-[var(--amber-fg)] bg-[var(--amber-bg)] p-5" role="alert">
      <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--amber-fg)]">
        Your plan has no room for another active vessel
      </p>
      <p className="mt-1.5 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--amber-fg)]">{message}</p>
      <p className="mt-1.5 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--amber-fg)]">
        {canGoFull
          ? `Full Access covers up to ${VESSEL_LIMIT.full}. Or free a slot by decommissioning or transferring a vessel you no longer need, then come back to this page.`
          : "Free a slot by decommissioning or transferring a vessel you no longer need, then come back to this page."}
      </p>
      <div className="mt-4 flex flex-wrap gap-2.5">
        {canGoFull ? (
          onChooseFull ? (
            <button
              type="button"
              onClick={onChooseFull}
              className="rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
            >
              Choose Full Access instead
            </button>
          ) : (
            <Link
              href="/dashboard/upgrade"
              className="rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
            >
              Upgrade to Full Access
            </Link>
          )
        ) : null}
        <Link
          href="/dashboard"
          className="rounded-lg border border-[var(--amber-fg)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--amber-fg)]"
        >
          Review your fleet
        </Link>
      </div>
    </div>
  );
}
