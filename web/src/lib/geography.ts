import { TRACKED_STATES, regionFor, trackedState } from "./region-config.ts";
import { stateName } from "./us-states.ts";

/**
 * Which vessels the admin counts, and where each one is kept — for
 * /admin/geography and the overview's summary card.
 *
 * COUNTED (decided 2026-09-24): paid and not decommissioned —
 * qr_status = 'active' AND lifecycle_status <> 'decommissioned'. Dormant
 * vessels (paused for a lapsed payment) still count: they're registered
 * boats that are somewhere. lifecycle_status is NOT NULL (20260906), so the
 * "not equal" filter can't silently drop rows. The overview's vessel totals
 * use the same filter, through countedVesselsFilter, so the two pages agree.
 *
 * WHERE (from the stored ZIP only — the free-text city fields are shown for
 * reference, never parsed):
 *   no storage_zip                     → Missing ZIP
 *   tracked state, county in a region  → that region
 *   tracked state, county not in one   → "<State>: other regions"
 *   any other state                    → Out of state, by state
 */

export const COUNTED_QR_STATUS = "active";
export const EXCLUDED_LIFECYCLE = "decommissioned";

/** The same rule as a predicate, for rows already fetched. */
export function isCountedVessel(v: { qr_status: string | null; lifecycle_status: string | null }): boolean {
  return v.qr_status === COUNTED_QR_STATUS && v.lifecycle_status !== EXCLUDED_LIFECYCLE;
}

/**
 * Applies the counted-vessels filter to a PostgREST query on `vessels`.
 * Both admin pages use this, so "how many vessels" means one thing.
 */
type Filterable = { eq(column: string, value: string): Filterable; neq(column: string, value: string): Filterable };

export function countedVesselsFilter<Q>(query: Q): Q {
  // Unconstrained Q on purpose: a structural constraint against the
  // PostgREST builder's types sends tsc into TS2589. The builder has eq/neq.
  const q = query as unknown as Filterable;
  return q.eq("qr_status", COUNTED_QR_STATUS).neq("lifecycle_status", EXCLUDED_LIFECYCLE) as unknown as Q;
}

export type GeoVessel = {
  mxe_id: string;
  vessel_name: string | null;
  storage_state: string | null;
  storage_zip: string | null;
  storage_county: string | null;
  storage_city: string | null;
  storage_description: string | null;
  marina_name: string | null;
  marina_city: string | null;
};

export type StateBreakdown = {
  code: string;
  label: string;
  regions: { key: string; label: string; count: number; marker: { lat: number; lon: number } }[];
  otherRegions: number;
  total: number;
};

export type Geography = {
  counted: number;
  states: StateBreakdown[];
  outOfState: { code: string; label: string; count: number }[];
  missingZip: (Pick<GeoVessel, "mxe_id" | "vessel_name"> & { rawLocation: string | null })[];
};

/** What the owner typed about the location, for reference beside a missing ZIP. */
export function rawLocation(v: GeoVessel): string | null {
  const parts = [v.marina_name, v.storage_description, v.storage_city ?? v.marina_city, v.storage_state]
    .map((p) => (p ?? "").trim())
    .filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** `vessels` must already be the counted set. */
export function summarizeGeography(vessels: GeoVessel[]): Geography {
  const states: StateBreakdown[] = TRACKED_STATES.map((s) => ({
    code: s.code,
    label: s.label,
    regions: s.regions.map((r) => ({ key: r.key, label: r.label, count: 0, marker: r.marker })),
    otherRegions: 0,
    total: 0,
  }));
  const outOfState = new Map<string, number>();
  const missingZip: Geography["missingZip"] = [];

  for (const v of vessels) {
    if (!v.storage_zip) {
      missingZip.push({ mxe_id: v.mxe_id, vessel_name: v.vessel_name, rawLocation: rawLocation(v) });
      continue;
    }
    const tracked = trackedState(v.storage_state);
    if (!tracked) {
      const code = (v.storage_state ?? "").toUpperCase() || "??";
      outOfState.set(code, (outOfState.get(code) ?? 0) + 1);
      continue;
    }
    const breakdown = states.find((s) => s.code === tracked.code)!;
    breakdown.total += 1;
    const region = regionFor(tracked.code, v.storage_county);
    if (region) breakdown.regions.find((r) => r.key === region.key)!.count += 1;
    else breakdown.otherRegions += 1;
  }

  for (const s of states) s.regions.sort((a, b) => b.count - a.count || 0);

  return {
    counted: vessels.length,
    states,
    outOfState: [...outOfState.entries()]
      .map(([code, count]) => ({ code, label: stateName(code) ?? code, count }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
    missingZip: missingZip.sort((a, b) => a.mxe_id.localeCompare(b.mxe_id)),
  };
}

/** Largest regions across all tracked states, for the overview card. */
export function topRegions(geo: Geography, limit = 3): { label: string; stateCode: string; count: number }[] {
  return geo.states
    .flatMap((s) => s.regions.map((r) => ({ label: r.label, stateCode: s.code, count: r.count })))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
}
