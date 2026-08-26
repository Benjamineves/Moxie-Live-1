import type { ProfileRole, VesselPreview, VesselRecord } from "@/types/vessel";
import { getDemoVessel } from "@/lib/demo-vessel";
import { getPublicSupabase } from "@/lib/supabase-public";

function normalizeRecord(row: Record<string, unknown>): VesselRecord {
  const r = row as VesselRecord;
  return r;
}

export async function fetchVesselByMxeId(mxeId: string): Promise<VesselRecord | null> {
  const normalized = mxeId.trim().toUpperCase();
  const supabase = getPublicSupabase();

  if (!supabase) {
    return getDemoVessel(normalized);
  }

  const { data, error } = await supabase.from("vessels").select("*").eq("mxe_id", normalized).maybeSingle();

  if (error || !data) {
    return getDemoVessel(normalized);
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
export function filterVesselForRole(v: VesselRecord, role: ProfileRole): Record<string, unknown> {
  const marina_name = v.marinas?.name ?? null;
  const marina_city = v.marinas?.city ?? null;

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
    marina_name,
    marina_city,
  };

  if (role === "public") {
    return basePublic;
  }

  if (role === "owner") {
    return {
      ...basePublic,
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
    };
  }

  if (role === "marina") {
    return {
      ...basePublic,
      slip_number: v.slip_number,
      marina_phone: v.marina_phone,
      is_liveaboard: v.is_liveaboard,
      slip_notes: v.slip_notes,
      owner_name: v.owner_name,
      owner_phone: v.owner_phone,
      owner_email: v.owner_email,
      ins_carrier: v.ins_carrier,
      ins_expiry: v.ins_expiry,
      reg_number: v.reg_number,
      reg_expiry: v.reg_expiry,
    };
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
