/** Role tiers from technical handoff v1 */
export type ProfileRole = "public" | "owner" | "marina" | "coastguard";

/** Flat row from DB join (snake_case) */
export type VesselRecord = {
  id: string;
  owner_id: string;
  marina_id: string | null;
  mxe_id: string;
  vessel_name: string;
  make: string;
  model: string;
  year: number;
  length_ft: number | string | null;
  draft_ft: number | string | null;
  vessel_type: string | null;
  photo_url: string | null;
  doc_registration_url: string | null;
  doc_insurance_url: string | null;
  doc_boater_card_url: string | null;
  public_notes: string | null;
  is_public?: boolean | null;
  storage_type: string | null;
  storage_description: string | null;
  /** Two-letter USPS code for where the vessel is stored (not registered). */
  storage_state: string | null;
  /** City name only, no state suffix. Captured for every storage type. */
  storage_city: string | null;
  marina_name: string | null;
  /** Legacy combined "City, ST" string — marina/mooring rows predating storage_city/storage_state. */
  marina_city: string | null;
  qr_status: string | null;
  qr_generated_at: string | null;
  sticker_order_status: string | null;
  claim_status: string | null;
  /** Fleet-membership status, independent of qr_status. 'active' | 'decommissioned' | 'dormant'. */
  lifecycle_status: string | null;
  decommissioned_at: string | null;
  decommission_reason: string | null;
  /** 'lapsed' | 'locked', only meaningful when lifecycle_status='dormant'. See lib/vessel-dormancy.ts. */
  dormant_cause: string | null;
  dormant_since: string | null;
  slip_number: string | null;
  marina_phone: string | null;
  is_liveaboard: boolean | null;
  slip_notes: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  preferred_contact: string | null;
  emg_name: string | null;
  emg_phone: string | null;
  emg_relationship: string | null;
  ins_carrier: string | null;
  ins_broker: string | null;
  ins_policy: string | null;
  ins_expiry: string | null;
  ins_liability: string | null;
  hin: string | null;
  uscg_doc_number: string | null;
  official_number: string | null;
  reg_state: string | null;
  reg_number: string | null;
  reg_expiry: string | null;
  engine: string | null;
  fuel_type: string | null;
  max_persons: number | null;
  lifejackets: number | null;
  fire_extinguisher: boolean | null;
  flares: boolean | null;
  sound_device: boolean | null;
  ca_boater_card: boolean | null;
  marinas?: { name: string; city: string | null; phone: string | null } | null;
};

export type VesselPreview = Pick<
  VesselRecord,
  "vessel_name" | "make" | "model" | "year" | "vessel_type"
>;
