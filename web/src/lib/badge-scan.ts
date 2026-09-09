/**
 * What a badge scan should do, decided in one place (spec §1.7).
 *
 * Separate from the route so every status can be tested. At the time
 * this was written every minted identity was still `minted`, so the live
 * route could only ever exercise one of four outcomes; the other three
 * would have shipped unverified, on a route whose entry point is glued
 * to a boat. Deciding here makes all four checkable without inventing
 * database rows to look at.
 *
 * The route does the I/O and executes the decision. It makes none of it.
 */

/** Statuses a badge identity can hold — mirrors the table's CHECK. */
export type BadgeIdentityStatus = "minted" | "printed" | "in_stock" | "assigned" | "void";

export type BadgeScanOutcome =
  /** Hand off to the existing scan branch at /<mxeId>?scan=1. */
  | { kind: "redirect"; mxeId: string }
  /** Render a calm 200. `reason` picks the copy. */
  | { kind: "notice"; reason: "unregistered" | "void" }
  /** 404. Only ever for a token that does not exist. */
  | { kind: "notFound" };

export type ScannedIdentity = {
  status: string;
  mxe_id: string;
  vesselMxeId: string | null;
};

/**
 * `null` identity means the token resolved to nothing — the only case
 * that 404s. A badge that exists but is not yet registered must render
 * (§1.7): a 404 on a physical product reads as a broken product, and a
 * badge sitting in a warehouse or a print shop is a normal, working
 * object that simply has no vessel yet.
 */
export function resolveBadgeScan(identity: ScannedIdentity | null): BadgeScanOutcome {
  if (!identity) return { kind: "notFound" };

  if (identity.status === "assigned") {
    // The vessel's own MXE ID wins over the identity's. They are the
    // same by construction — assignment gives the identity's reserved ID
    // to the vessel — but /<mxeId> resolves the vessel row, and
    // apply_vessel_identity_correction exists. Following the vessel
    // keeps a corrected boat reachable from its badge; falling back to
    // the identity's ID keeps a badge on a hull pointing somewhere real
    // even if the join comes back empty.
    return { kind: "redirect", mxeId: identity.vesselMxeId ?? identity.mxe_id };
  }

  if (identity.status === "void") return { kind: "notice", reason: "void" };

  // minted, printed, in_stock — and anything a future migration adds.
  //
  // The spec names in_stock; minted and printed are the states a badge
  // occupies while it is being produced. A badge scanned on a packing
  // line is in the same position as one scanned on a shelf: real,
  // unregistered, not an error. Defaulting unknown statuses here rather
  // than throwing is deliberate — a status this code has not heard of
  // should degrade to the calmest true statement available, not 500 on
  // someone holding a boat badge.
  return { kind: "notice", reason: "unregistered" };
}
