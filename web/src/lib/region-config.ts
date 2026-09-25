/**
 * THE ONLY PLACE REGIONS ARE DEFINED.
 *
 * Tracked states, their regions, and the counties in each. A vessel's region
 * comes from vessels.storage_county (derived server-side from its storage ZIP,
 * lib/storage-zip.ts) looked up here. Anything with a valid ZIP whose county
 * isn't listed falls to "<State>: other regions"; a vessel stored outside the
 * tracked states is "out of state".
 *
 * Adding a region — or a state — is a change to this file only: add an entry
 * with its counties and a marker. region-config.test.mts checks every county
 * name against the Census names the ZIP lookup stores, that no county sits in
 * two regions, and that each marker falls inside its state.
 *
 * County names are written without the " County" suffix; the Census names
 * stored on vessels carry it (all three tracked states use counties, not
 * parishes or boroughs), and countyKey() bridges the two.
 *
 * Markers are latitude/longitude of a representative harbour, not map pixels,
 * so each state map projects them itself. They're placement only — nothing
 * is counted by them. Chosen 2026-09-25; adjust freely.
 *
 * Approved 2026-09-25: CA regions as specified (Ventura in Southern
 * California) plus the Delta; FL with the Keys separate, Big Bend and the
 * Orlando lakes left in "other"; WA with South Sound merged into Central
 * Puget Sound.
 */

export type RegionDef = {
  key: string;
  label: string;
  counties: readonly string[];
  marker: { lat: number; lon: number };
};

export type TrackedState = {
  code: "CA" | "FL" | "WA";
  label: string;
  regions: readonly RegionDef[];
};

export const TRACKED_STATES: readonly TrackedState[] = [
  {
    code: "CA",
    label: "California",
    regions: [
      {
        key: "sf_bay_area",
        label: "SF Bay Area",
        counties: ["Alameda", "Contra Costa", "Marin", "Napa", "San Francisco", "San Mateo", "Santa Clara", "Solano", "Sonoma"],
        marker: { lat: 37.86, lon: -122.46 }, // Sausalito / Richardson Bay
      },
      {
        key: "delta",
        label: "Delta",
        counties: ["Sacramento", "San Joaquin"],
        marker: { lat: 38.07, lon: -121.62 }, // Rio Vista / the Delta channels
      },
      {
        key: "central_coast",
        label: "Central Coast",
        counties: ["Santa Cruz", "Monterey", "San Benito", "San Luis Obispo", "Santa Barbara"],
        marker: { lat: 36.6, lon: -121.89 }, // Monterey
      },
      {
        key: "southern_california",
        label: "Southern California",
        counties: ["Ventura", "Los Angeles", "Orange", "San Diego", "Riverside", "San Bernardino", "Imperial"],
        marker: { lat: 33.72, lon: -118.2 }, // Los Angeles / Long Beach harbours
      },
    ],
  },
  {
    code: "FL",
    label: "Florida",
    regions: [
      {
        key: "southeast_florida",
        label: "Southeast Florida",
        counties: ["Miami-Dade", "Broward", "Palm Beach"],
        marker: { lat: 26.12, lon: -80.14 }, // Fort Lauderdale
      },
      {
        key: "florida_keys",
        label: "Florida Keys",
        counties: ["Monroe"],
        marker: { lat: 24.71, lon: -81.09 }, // Marathon
      },
      {
        key: "treasure_space_coast",
        label: "Treasure & Space Coast",
        counties: ["Martin", "St. Lucie", "Indian River", "Brevard", "Volusia"],
        marker: { lat: 27.9, lon: -80.5 }, // Indian River Lagoon
      },
      {
        key: "northeast_florida",
        label: "Northeast Florida",
        counties: ["Flagler", "St. Johns", "Duval", "Nassau", "Clay", "Putnam"],
        marker: { lat: 30.33, lon: -81.66 }, // Jacksonville / St. Johns River
      },
      {
        key: "tampa_bay",
        label: "Tampa Bay",
        counties: ["Hernando", "Pasco", "Pinellas", "Hillsborough", "Manatee"],
        marker: { lat: 27.77, lon: -82.64 }, // St. Petersburg
      },
      {
        key: "southwest_florida",
        label: "Southwest Florida",
        counties: ["Sarasota", "Charlotte", "Lee", "Collier"],
        marker: { lat: 26.64, lon: -81.87 }, // Fort Myers
      },
      {
        key: "panhandle",
        label: "Panhandle",
        counties: ["Escambia", "Santa Rosa", "Okaloosa", "Walton", "Bay", "Gulf", "Franklin", "Wakulla"],
        marker: { lat: 30.39, lon: -86.49 }, // Destin
      },
    ],
  },
  {
    code: "WA",
    label: "Washington",
    regions: [
      {
        key: "central_puget_sound",
        label: "Central Puget Sound",
        counties: ["King", "Snohomish", "Pierce", "Kitsap", "Thurston", "Mason"],
        marker: { lat: 47.61, lon: -122.34 }, // Seattle
      },
      {
        key: "north_sound_san_juans",
        label: "North Sound & San Juans",
        counties: ["Whatcom", "Skagit", "San Juan", "Island"],
        marker: { lat: 48.51, lon: -122.61 }, // Anacortes
      },
      {
        key: "olympic_peninsula",
        label: "Olympic Peninsula",
        counties: ["Clallam", "Jefferson"],
        marker: { lat: 48.12, lon: -123.43 }, // Port Angeles
      },
      {
        key: "wa_coast",
        label: "Coast",
        counties: ["Grays Harbor", "Pacific"],
        marker: { lat: 46.89, lon: -124.1 }, // Westport
      },
      {
        key: "lower_columbia",
        label: "Lower Columbia",
        counties: ["Wahkiakum", "Cowlitz", "Clark"],
        marker: { lat: 45.9, lon: -122.8 }, // Columbia River, Vancouver–Longview
      },
    ],
  },
];

/** "Marin County" / "Marin" / " marin county " → "marin". */
export function countyKey(name: string): string {
  return name.trim().replace(/\s+county$/i, "").trim().toLowerCase();
}

export function trackedState(code: string | null | undefined): TrackedState | null {
  const upper = (code ?? "").trim().toUpperCase();
  return TRACKED_STATES.find((s) => s.code === upper) ?? null;
}

/**
 * The region a stored county belongs to, or null when the state isn't
 * tracked or the county isn't in any of its regions ("other regions").
 */
export function regionFor(stateCode: string | null | undefined, county: string | null | undefined): RegionDef | null {
  const state = trackedState(stateCode);
  if (!state || !county) return null;
  const key = countyKey(county);
  return state.regions.find((r) => r.counties.some((c) => countyKey(c) === key)) ?? null;
}
