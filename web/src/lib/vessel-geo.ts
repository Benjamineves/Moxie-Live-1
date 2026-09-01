/**
 * Region-level classification of free-text storage location into
 * California regions, for the admin overview's geographic section.
 *
 * Source text per vessel: marina_city (falling back to the legacy
 * marinas-table join for MXE-00001/00002, which predate that column)
 * when storage_type is 'marina'/'mooring'; storage_description for
 * every other storage_type. reg_state is deliberately NOT used here —
 * it's the boat's registration state, not where it's currently stored.
 *
 * Matching is keyword-based against curated city/place lists per
 * region. No match against those lists falls to "other" only when a
 * real state signal (a 2-letter code or state name) is present in the
 * text, and to "unclassified" otherwise — ambiguous or unparseable
 * text is never guessed into a region.
 */

export type GeoRegionKey = "sf_bay_area" | "central_coast" | "southern_california" | "other" | "unclassified";

export const GEO_REGIONS: { key: GeoRegionKey; label: string }[] = [
  { key: "sf_bay_area", label: "SF Bay Area" },
  { key: "central_coast", label: "Central Coast" },
  { key: "southern_california", label: "Southern California" },
  { key: "other", label: "Other (CA / out of state)" },
  { key: "unclassified", label: "Unclassified" },
];

const SF_BAY_AREA_KEYWORDS = [
  "san francisco", "oakland", "berkeley", "alameda", "emeryville", "sausalito",
  "point richmond", "richmond", "san rafael", "novato", "tiburon", "larkspur",
  "mill valley", "corte madera", "vallejo", "benicia", "martinez", "pittsburg",
  "antioch", "concord", "walnut creek", "pleasant hill", "danville", "san ramon",
  "dublin", "pleasanton", "livermore", "hayward", "fremont", "union city",
  "newark", "milpitas", "san jose", "santa clara", "sunnyvale", "mountain view",
  "palo alto", "redwood city", "san mateo", "foster city", "burlingame",
  "half moon bay", "napa", "sonoma", "petaluma", "santa rosa",
  "jack london square", "brickyard cove", "clipper yacht harbor", "emery cove",
  "portobello marina",
];

const CENTRAL_COAST_KEYWORDS = [
  "marina del rey", "playa del rey",
  "santa barbara", "montecito", "goleta", "carpinteria", "ventura", "oxnard",
  "camarillo", "port hueneme", "santa cruz", "capitola", "monterey",
  "pacific grove", "carmel", "seaside", "morro bay", "san luis obispo",
  "pismo beach", "avila beach",
];

const SOUTHERN_CALIFORNIA_KEYWORDS = [
  "san diego", "mission bay", "point loma", "coronado", "chula vista",
  "national city", "oceanside", "carlsbad", "encinitas", "la jolla",
  "orange county", "newport beach", "huntington beach", "costa mesa",
  "dana point", "san clemente", "laguna beach", "long beach", "san pedro",
  "los angeles", "redondo beach", "torrance", "wilmington", "terminal island",
];

const STATE_CODES = new Set([
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL",
  "IN", "IA", "KS", "KY", "LA", "ME", "MD", "MA", "MI", "MN", "MS", "MO", "MT",
  "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI",
  "SC", "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
]);

// Fallback-only signal for the "other" bucket, not exhaustive — a match
// here never picks a specific region, only confirms "this is a real,
// parseable place, just not one of the three we track."
const STATE_NAMES = [
  "california", "nevada", "oregon", "washington", "arizona", "texas",
  "florida", "new york", "colorado", "utah", "idaho", "hawaii", "alaska",
];

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
}

function toWordPattern(keyword: string): RegExp {
  return new RegExp(`\\b${keyword.replace(/ /g, "\\s+")}\\b`);
}

function matchesAny(normalized: string, keywords: string[]): boolean {
  return keywords.some((kw) => toWordPattern(kw).test(normalized));
}

function hasStateSignal(raw: string): boolean {
  const codeTokens = raw.match(/\b[A-Z]{2}\b/g);
  if (codeTokens?.some((token) => STATE_CODES.has(token))) return true;
  const normalized = normalize(raw);
  return STATE_NAMES.some((name) => toWordPattern(name).test(normalized));
}

export function classifyRegion(sourceText: string | null | undefined): GeoRegionKey {
  const raw = (sourceText ?? "").trim();
  if (!raw) return "unclassified";

  const normalized = normalize(raw);
  if (matchesAny(normalized, SF_BAY_AREA_KEYWORDS)) return "sf_bay_area";
  if (matchesAny(normalized, CENTRAL_COAST_KEYWORDS)) return "central_coast";
  if (matchesAny(normalized, SOUTHERN_CALIFORNIA_KEYWORDS)) return "southern_california";

  return hasStateSignal(raw) ? "other" : "unclassified";
}

export function resolveVesselLocationSource(
  vessel: { storage_type: string | null; marina_city: string | null; storage_description: string | null },
  legacyMarinaLocation?: string | null,
): string | null {
  if (vessel.storage_type === "marina" || vessel.storage_type === "mooring") {
    return vessel.marina_city ?? legacyMarinaLocation ?? null;
  }
  return vessel.storage_description ?? null;
}
