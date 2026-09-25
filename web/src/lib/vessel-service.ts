import type { ProfileRole, VesselPreview, VesselRecord } from "@/types/vessel";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";

function normalizeRecord(row: Record<string, unknown>): VesselRecord {
  const r = row as VesselRecord;
  return r;
}

/**
 * The whole row, read with the SERVICE ROLE. Callers must pass it through
 * filterVesselForRole / toPreview before any of it leaves the server.
 *
 * This used to read with the anon key, which only worked because anon had
 * SELECT on vessels — every column of every public row, so anyone holding
 * the key from the browser bundle could read mailing addresses straight
 * from /rest/v1/vessels. 20261010 revokes that grant; this read no longer
 * depends on it. `is_public = true` is the row rule the anon RLS policy
 * applied, kept here so the service role doesn't widen what resolves.
 *
 * A missing service role throws (a 500), never demo data — the old anon
 * path once served a FAKE BOAT at a real MXE ID.
 */
export async function fetchVesselByMxeId(mxeId: string): Promise<VesselRecord | null> {
  const normalized = mxeId.trim().toUpperCase();
  const supabase = requireSupabaseServiceClient(`lib/vessel-service ${normalized}`);

  const { data, error } = await supabase
    .from("vessels")
    .select("*")
    .eq("mxe_id", normalized)
    .eq("is_public", true)
    .maybeSingle();

  if (error) {
    // A real Supabase/query error must surface, not be masked by demo data.
    throw new Error(`Failed to fetch vessel ${normalized}: ${error.message}`);
  }

  if (!data) {
    // Genuine not-found: no row, no error. Let callers 404 — never demo-fill this.
    return null;
  }

  const row = normalizeRecord(data as Record<string, unknown>);
  const marinaId = row.marina_id;

  if (marinaId) {
    const { data: m } = await supabase
      .from("marinas")
      .select("name, city, phone")
      .eq("id", marinaId)
      .maybeSingle();
    if (m) {
      row.marinas = { name: m.name, city: m.city ?? null, phone: m.phone ?? null };
    }
  }

  return row;
}

export function toPreview(v: VesselRecord): VesselPreview {
  return {
    vessel_name: v.vessel_name,
    make: v.make,
    model: v.model,
    year: v.year,
    vessel_type: v.vessel_type,
  };
}

/** Field visibility per technical handoff v1 (subset implemented for P0). */
export function filterVesselForRole(v: VesselRecord, role: Exclude<ProfileRole, "marina">): Record<string, unknown> {
  // Prefer the vessel's own free-text marina_name/marina_city (self-serve
  // intake, build spec §3 addendum). Fall back to the marina_id join only
  // for vessels seeded before that column existed (MXE-00001/MXE-00002),
  // which have marina_id set but no free-text value — see the migration
  // comment on marina_name/marina_city for why marina_id itself is never
  // populated for new signups.
  const marina_name = v.marina_name ?? v.marinas?.name ?? null;
  const marina_city = v.marina_city ?? v.marinas?.city ?? null;

  const basePublic = {
    mxe_id: v.mxe_id,
    vessel_name: v.vessel_name,
    vessel_type: v.vessel_type,
    make: v.make,
    model: v.model,
    year: v.year,
    length_ft: v.length_ft,
    draft_ft: v.draft_ft,
    public_notes: v.public_notes,
    photo_url: v.photo_url,
    // Public location is the storage TYPE plus city and state, nothing
    // finer (decided 2026-09-25). The marina name, the legacy marina_city
    // string and the free-text storage description are owner-only, below —
    // a stranger scanning a badge shouldn't learn which marina the boat is
    // in. storage-zip.test.mts checks none of them is here.
    storage_type: v.storage_type,
    storage_state: v.storage_state,
    storage_city: v.storage_city,
  };

  if (role === "public") {
    return basePublic;
  }

  if (role === "owner") {
    return {
      ...basePublic,
      // Owner-only: whether this vessel still needs the badge fee paid.
      // Not part of basePublic — the public page already gates on this
      // separately (via the full VesselRecord, before this function is
      // even called) and shows its own "not yet active" state instead of
      // ever reaching VesselPublicProfile, so public callers don't need
      // it duplicated here.
      qr_status: v.qr_status,
      // Same reasoning as qr_status above — the public page already
      // gates on lifecycle_status separately, before this function is
      // ever called for a decommissioned vessel's public view.
      lifecycle_status: v.lifecycle_status,
      decommission_reason: v.decommission_reason,
      dormant_cause: v.dormant_cause,
      // Owner-only, like the slip: where the boat is kept, to the ZIP.
      // Never in basePublic (storage-zip.test.mts checks).
      storage_zip: v.storage_zip ?? null,
      storage_description: v.storage_description,
      marina_name,
      marina_city,
      slip_number: v.slip_number,
      marina_phone: v.marina_phone,
      is_liveaboard: v.is_liveaboard,
      slip_notes: v.slip_notes,
      owner_name: v.owner_name,
      owner_phone: v.owner_phone,
      owner_email: v.owner_email,
      preferred_contact: v.preferred_contact,
      emg_name: v.emg_name,
      emg_phone: v.emg_phone,
      emg_relationship: v.emg_relationship,
      ins_carrier: v.ins_carrier,
      ins_broker: v.ins_broker,
      ins_policy: v.ins_policy,
      ins_expiry: v.ins_expiry,
      ins_liability: v.ins_liability,
      hin: v.hin,
      uscg_doc_number: v.uscg_doc_number,
      official_number: v.official_number,
      reg_state: v.reg_state,
      reg_number: v.reg_number,
      reg_expiry: v.reg_expiry,
      engine: v.engine,
      fuel_type: v.fuel_type,
      max_persons: v.max_persons,
      lifejackets: v.lifejackets,
      fire_extinguisher: v.fire_extinguisher,
      flares: v.flares,
      sound_device: v.sound_device,
      ca_boater_card: v.ca_boater_card,
      doc_registration_url: v.doc_registration_url,
      doc_insurance_url: v.doc_insurance_url,
      doc_boater_card_url: v.doc_boater_card_url,
    };
  }

  if ((role as ProfileRole) === "marina") {
    // Not a role this function can answer. What a marina sees depends on
    // what the owner granted (which documents), so it is built by
    // buildMarinaView(vessel, grant) in lib/marina-view.ts — the one
    // definition (docs/moxie_digital_marina_access_spec.md §2.2). The old
    // shape here was wrong in both directions: no emergency contact, and it
    // leaked slip_notes, is_liveaboard and ins_carrier. Excluded from the
    // parameter type too; this throw is for anything that gets past it.
    throw new Error("filterVesselForRole does not build the marina view; use buildMarinaView with the grant.");
  }

  // coastguard
  return {
    ...basePublic,
    slip_number: v.slip_number,
    marina_phone: v.marina_phone,
    owner_name: v.owner_name,
    owner_phone: v.owner_phone,
    owner_email: v.owner_email,
    emg_name: v.emg_name,
    emg_phone: v.emg_phone,
    emg_relationship: v.emg_relationship,
    ins_carrier: v.ins_carrier,
    ins_broker: v.ins_broker,
    ins_policy: v.ins_policy,
    ins_expiry: v.ins_expiry,
    ins_liability: v.ins_liability,
    hin: v.hin,
    uscg_doc_number: v.uscg_doc_number,
    official_number: v.official_number,
    reg_state: v.reg_state,
    reg_number: v.reg_number,
    reg_expiry: v.reg_expiry,
    engine: v.engine,
    fuel_type: v.fuel_type,
    max_persons: v.max_persons,
    lifejackets: v.lifejackets,
    fire_extinguisher: v.fire_extinguisher,
    flares: v.flares,
    sound_device: v.sound_device,
  };
}
