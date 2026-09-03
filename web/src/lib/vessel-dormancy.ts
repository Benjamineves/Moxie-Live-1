/**
 * Dormant Vessel Identity (docs/moxie_digital_dormant_identity_spec.md).
 *
 * The one place that turns the distinct stored signals — lifecycle_status
 * and dormant_cause — into the single computed answer every consumer
 * (the public page, any tier-gated feature check) actually needs. The
 * three causes stay distinct in storage (different reversal paths,
 * different admin semantics); this is where they resolve to one shared
 * effect. Don't inline `lifecycle_status === 'dormant'` checks elsewhere
 * — go through this so a future fourth cause, or a rename, has one call
 * site to change.
 */

export type DormantCause = "lapsed" | "locked" | "decommissioned";

export type DormantInfo = { isDormant: boolean; cause: DormantCause | null };

type VesselLifecycleFields = {
  lifecycle_status: string | null;
  dormant_cause: string | null;
};

export function getDormantInfo(vessel: VesselLifecycleFields): DormantInfo {
  if (vessel.lifecycle_status === "decommissioned") {
    return { isDormant: true, cause: "decommissioned" };
  }
  if (vessel.lifecycle_status === "dormant") {
    const cause = vessel.dormant_cause === "lapsed" || vessel.dormant_cause === "locked" ? vessel.dormant_cause : null;
    return { isDormant: true, cause };
  }
  return { isDormant: false, cause: null };
}

/**
 * Public-facing copy per cause (spec §4): same layout, different tone —
 * never disclose *why* beyond this. Lapsed/locked both read as "still
 * has a Moxie identity, not currently active, sign in to reactivate."
 * Decommissioned stays closer to "no longer part of the active fleet"
 * (a deliberate action, not an inactive management layer) but drops the
 * flat epitaph in favor of the same retained-identity display, with a
 * contact link rather than a self-serve button — real reactivation
 * there stays admin-mediated (spec §6's new-owner claim path is
 * explicitly not built here).
 */
export const DORMANT_PUBLIC_COPY: Record<DormantCause, { headline: string; body: string; ctaLabel: string }> = {
  lapsed: {
    headline: "Not currently active.",
    body: "This vessel has a permanent Moxie identity, but its subscription has lapsed — the owner can reactivate it any time.",
    ctaLabel: "Sign in to reactivate →",
  },
  locked: {
    headline: "Not currently active.",
    body: "This vessel has a permanent Moxie identity, but it isn't currently covered by an active plan — the owner can reactivate it any time.",
    ctaLabel: "Sign in to reactivate →",
  },
  decommissioned: {
    headline: "No longer part of the active fleet.",
    body: "This vessel has a permanent Moxie identity. If you're its new owner, get in touch to claim it.",
    ctaLabel: "Contact Moxie →",
  },
};
