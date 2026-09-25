import { ZIP_COUNTY_TSV } from "./geo/zip-county-data.ts";
import { normalizeStateCode, stateName } from "./us-states.ts";

/**
 * The storage ZIP: where the boat is kept, validated against the storage
 * state, and the county derived from it — server-side only (the lookup is
 * ~0.9 MB and must never reach a client bundle).
 *
 * Every write of vessels.storage_zip goes through checkStorageZip, and
 * vessels.storage_county is only ever set from its result:
 *   - registration: app/dashboard/new/actions.ts#createVessel
 *   - the Storage section: lib/owner-actions.ts#updateVesselOwnerFields,
 *     via storagePatchForSave below
 *   - admin backfill: app/admin/geography/actions.ts#backfillStorageZip,
 *     via adminBackfillPatch below
 * storage-zip.test.mts fails if either stops calling it.
 *
 * Source: Census 2020 ZCTA-to-county file (scripts/generate-zip-county.mjs).
 * ZCTAs approximate ZIPs; a PO-box-only ZIP isn't in it and is refused with
 * a message asking for the ZIP of where the boat physically is.
 */

let lookup: Map<string, Map<string, string>> | null = null;

function table(): Map<string, Map<string, string>> {
  if (lookup) return lookup;
  const built = new Map<string, Map<string, string>>();
  for (const line of ZIP_COUNTY_TSV.split("\n")) {
    const tab = line.indexOf("\t");
    const states = new Map<string, string>();
    for (const part of line.slice(tab + 1).split("|")) {
      const colon = part.indexOf(":");
      states.set(part.slice(0, colon), part.slice(colon + 1));
    }
    built.set(line.slice(0, tab), states);
  }
  lookup = built;
  return built;
}

/** "94965", " 94965 ", "94965-1234" → "94965"; anything else → null. */
export function normalizeZip(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const m = raw.trim().match(/^(\d{5})(?:-\d{4})?$/);
  return m ? m[1] : null;
}

export type ZipCheck = { ok: true; zip: string; county: string } | { ok: false; error: string };

export function checkStorageZip(rawZip: unknown, rawState: unknown): ZipCheck {
  const zip = normalizeZip(rawZip);
  if (!zip) return { ok: false, error: "Enter the 5-digit ZIP code where the boat is kept." };

  const state = normalizeStateCode(typeof rawState === "string" ? rawState : null);
  if (!state) return { ok: false, error: "Choose the state the boat is kept in first." };

  const states = table().get(zip);
  if (!states) {
    return {
      ok: false,
      error: `We can't find ZIP ${zip}. Check it, or use the ZIP of the marina, yard or address where the boat is — not a PO box.`,
    };
  }
  const county = states.get(state);
  if (!county) {
    const where = [...states.keys()].map((s) => stateName(s) ?? s).join(" / ");
    return { ok: false, error: `ZIP ${zip} is in ${where}, not ${stateName(state) ?? state}. Check the ZIP or the state.` };
  }
  return { ok: true, zip, county };
}

/**
 * Fields that make up the Storage section. A save that touches any of them
 * is a Storage save, and must carry a valid ZIP for the resulting state.
 */
export const STORAGE_SECTION_FIELDS = [
  "storage_type",
  "storage_description",
  "storage_state",
  "storage_city",
  "storage_zip",
  "marina_name",
  "marina_city",
  "slip_number",
  "marina_phone",
  "is_liveaboard",
  "slip_notes",
] as const;

/**
 * Given an owner's patch and the vessel's stored state, returns what to add
 * to the update (the normalized ZIP and its county), or an error. A patch
 * that touches no Storage field passes through untouched. storage_county in
 * a patch is never honoured — it is overwritten here or dropped.
 */
export function storagePatchForSave(
  patch: Record<string, unknown>,
  storedState: string | null,
): { ok: true; set: { storage_zip?: string; storage_county?: string } } | { ok: false; error: string } {
  const touchesStorage = STORAGE_SECTION_FIELDS.some((f) => f in patch);
  if (!touchesStorage) return { ok: true, set: {} };
  const state = "storage_state" in patch ? patch.storage_state : storedState;
  const checked = checkStorageZip(patch.storage_zip, state);
  if (!checked.ok) return checked;
  return { ok: true, set: { storage_zip: checked.zip, storage_county: checked.county } };
}

/**
 * Admin backfill of a vessel that has no ZIP yet (/admin/geography, Missing
 * ZIP). The same check as an owner's save. A vessel with a state on file is
 * checked against it and its state is left alone; only a vessel with no
 * state takes the one the admin picks, and then it is written too.
 */
export function adminBackfillPatch(
  rawZip: unknown,
  storedState: string | null,
  chosenState: unknown,
):
  | { ok: true; set: { storage_zip: string; storage_county: string; storage_state?: string } }
  | { ok: false; error: string } {
  const stored = normalizeStateCode(storedState);
  const state = stored ?? normalizeStateCode(typeof chosenState === "string" ? chosenState : null);
  const checked = checkStorageZip(rawZip, state);
  if (!checked.ok) return checked;
  return {
    ok: true,
    set: { storage_zip: checked.zip, storage_county: checked.county, ...(stored ? {} : { storage_state: state! }) },
  };
}
