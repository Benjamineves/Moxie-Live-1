import type { VesselRecord } from "@/types/vessel";

export type ShareFieldFlags = {
  location: boolean;
  contact: boolean;
  docs: boolean;
  ownership: boolean;
  access: boolean;
};

export const SHARE_PRESETS = ["escrow", "marina", "vendor", "custom"] as const;
export type SharePreset = (typeof SHARE_PRESETS)[number];

/** Spec §3: "client sets these field_flags combinations; server doesn't need to know about presets, just validates the resulting flags." Exported anyway so the owner UI and any future caller share one definition. */
export const PRESET_FLAGS: Record<Exclude<SharePreset, "custom">, ShareFieldFlags> = {
  escrow: { location: true, contact: true, docs: true, ownership: true, access: false },
  marina: { location: true, contact: true, docs: false, ownership: false, access: true },
  vendor: { location: true, contact: false, docs: false, ownership: false, access: true },
};

/** Baseline is always present; the rest are present only when their flag is on — matches SharedVesselProfile's optional-field props exactly, so no unsafe cast is needed where the two meet. */
export type FilteredShareVessel = {
  mxe_id: string;
  vessel_name: string;
  vessel_type: string | null;
  make: string;
  model: string;
  year: number;
  length_ft: number | string | null;
  draft_ft: number | string | null;
  engine: string | null;
  public_notes: string | null;
  photo_url: string | null;
  marina_name?: string | null;
  marina_city?: string | null;
  storage_type?: string | null;
  storage_description?: string | null;
  slip_number?: string | null;
  marina_phone?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  doc_registration_url?: string | null;
  doc_insurance_url?: string | null;
  doc_boater_card_url?: string | null;
  hin?: string | null;
  uscg_doc_number?: string | null;
  official_number?: string | null;
  reg_state?: string | null;
  reg_number?: string | null;
  reg_expiry?: string | null;
  access_note?: string | null;
};

export function isShareFieldFlags(value: unknown): value is ShareFieldFlags {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (["location", "contact", "docs", "ownership", "access"] as const).every((k) => typeof v[k] === "boolean");
}

/**
 * Field-group -> column mapping (spec §3). A few placements aren't
 * explicitly specified and are judgment calls, noted inline:
 *  - "Vessel specs" is always-included baseline per the spec, matching
 *    the recipient-view mockup's spec-strip (which includes Engine,
 *    not shown on the ordinary public profile) — engine is added to
 *    baseline here even though it's a locked-for-editing field
 *    elsewhere; visibility and edit-lock are separate concerns.
 *  - public_notes/photo_url are baseline too, matching the mockup's
 *    always-shown "About this vessel" section.
 *  - marina/storage fields (previously bundled into the public
 *    profile's baseline) move to the `location` flag here instead,
 *    matching the mockup's dedicated "Location" section.
 *  - Emergency contact, structured insurance detail fields (ins_carrier,
 *    ins_broker, ins_policy, ins_expiry, ins_liability — the "Insurance"
 *    section in VesselOwnerProfile.tsx), and safety-equipment fields are
 *    not covered by any flag and are never shareable via this feature at
 *    all — the mockup's own copy is explicit: "They won't see:
 *    emergency contacts, billing info, or anything you haven't
 *    toggled on." This is distinct from the actual uploaded insurance
 *    *document* (doc_insurance_url), which IS reachable — see `docs`
 *    below — the escrow preset needs the file, not the structured
 *    policy-number fields.
 *  - `ownership` exposes the fuller 9-field locked set from the
 *    identity-audit trigger (hin, make, model, year, length_ft,
 *    draft_ft, engine, uscg_doc_number, official_number, vessel_type)
 *    intersected with what isn't already baseline — i.e. hin,
 *    uscg_doc_number, official_number — plus reg_state/reg_number/
 *    reg_expiry, matching the existing "Registration & documentation"
 *    section and the spec's "HIN, registration #, title status"
 *    description. This is a read-only exposure — the share feature
 *    never grants any write path, same as everywhere else these
 *    fields appear.
 */
export function filterVesselForShare(
  vessel: VesselRecord,
  flags: ShareFieldFlags,
  accessNote: string | null,
): FilteredShareVessel {
  const out: FilteredShareVessel = {
    mxe_id: vessel.mxe_id,
    vessel_name: vessel.vessel_name,
    vessel_type: vessel.vessel_type,
    make: vessel.make,
    model: vessel.model,
    year: vessel.year,
    length_ft: vessel.length_ft,
    draft_ft: vessel.draft_ft,
    engine: vessel.engine,
    public_notes: vessel.public_notes,
    photo_url: vessel.photo_url,
  };

  if (flags.location) {
    out.marina_name = vessel.marina_name ?? vessel.marinas?.name ?? null;
    out.marina_city = vessel.marina_city ?? vessel.marinas?.city ?? null;
    out.storage_type = vessel.storage_type;
    out.storage_description = vessel.storage_description;
    out.slip_number = vessel.slip_number;
    out.marina_phone = vessel.marina_phone;
  }

  if (flags.contact) {
    out.owner_name = vessel.owner_name;
    out.owner_phone = vessel.owner_phone;
  }

  if (flags.docs) {
    // The uploaded files themselves (spec: "uploaded files marked
    // shareable"), not the structured ins_carrier/ins_policy/etc.
    // fields — those stay excluded regardless of this flag, see the
    // note above.
    out.doc_registration_url = vessel.doc_registration_url;
    out.doc_insurance_url = vessel.doc_insurance_url;
    out.doc_boater_card_url = vessel.doc_boater_card_url;
  }

  if (flags.ownership) {
    out.hin = vessel.hin;
    out.uscg_doc_number = vessel.uscg_doc_number;
    out.official_number = vessel.official_number;
    out.reg_state = vessel.reg_state;
    out.reg_number = vessel.reg_number;
    out.reg_expiry = vessel.reg_expiry;
  }

  if (flags.access) {
    out.access_note = accessNote;
  }

  return out;
}
