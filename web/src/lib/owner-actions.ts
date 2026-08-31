"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";

/**
 * Updates photo_url on an already-existing vessel — the counterpart to
 * intake's create-time photo handling, which only ever writes photo_url as
 * part of the initial INSERT and has no update path of its own. The upload
 * itself (bucket, path convention) happens client-side before this is
 * called, identical to what VesselIntakeForm.tsx already does.
 */
export async function updateVesselPhoto(mxeId: string, photoUrl: string): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as { id: string; owner_id: string } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }

  const { error } = await service.from("vessels").update({ photo_url: photoUrl }).eq("id", vessel.id);
  if (error) return { error: error.message };
  return {};
}

// hin, make, model, year, vessel_type, length_ft, draft_ft, engine,
// uscg_doc_number, official_number are deliberately NOT here — they define
// which physical object a vessel record represents, and a real ownership
// transfer never touches them (it only reassigns owner_id). Self-serve
// editing of these is locked out entirely, not just confirm-gated: fixing
// one is a support-mediated direct-DB edit, audited by a trigger (see
// migration 20260830_vessel_identity_lock_and_audit.sql), not something
// this action — or any owner-authenticated request — can reach.
type IntrinsicPatch = Partial<{
  vessel_name: string;
  reg_state: string | null;
  reg_number: string | null;
  reg_expiry: string | null;
}>;

const INTRINSIC_FIELDS = ["vessel_name", "reg_state", "reg_number", "reg_expiry"] as const;

type OwnerPatch = Partial<{
  storage_type: string;
  storage_description: string | null;
  marina_name: string | null;
  marina_city: string | null;
  slip_number: string | null;
  marina_phone: string | null;
  is_liveaboard: boolean | null;
  slip_notes: string | null;
  owner_name: string;
  owner_phone: string | null;
  owner_email: string | null;
  preferred_contact: string | null;
  emg_name: string | null;
  emg_phone: string | null;
  emg_relationship: string | null;
  public_notes: string | null;
  ins_carrier: string | null;
  ins_broker: string | null;
  ins_policy: string | null;
  ins_expiry: string | null;
  ins_liability: string | null;
  fuel_type: string | null;
  max_persons: number | null;
  lifejackets: number | null;
  fire_extinguisher: boolean | null;
  flares: boolean | null;
  sound_device: boolean | null;
  ca_boater_card: boolean | null;
}>;

const OWNER_FIELDS = [
  "storage_type",
  "storage_description",
  "marina_name",
  "marina_city",
  "slip_number",
  "marina_phone",
  "is_liveaboard",
  "slip_notes",
  "owner_name",
  "owner_phone",
  "owner_email",
  "preferred_contact",
  "emg_name",
  "emg_phone",
  "emg_relationship",
  "public_notes",
  "ins_carrier",
  "ins_broker",
  "ins_policy",
  "ins_expiry",
  "ins_liability",
  "fuel_type",
  "max_persons",
  "lifejackets",
  "fire_extinguisher",
  "flares",
  "sound_device",
  "ca_boater_card",
] as const;

function pickAllowed<T extends object>(patch: T, allowed: readonly (keyof T)[]): Partial<T> {
  const out: Partial<T> = {};
  for (const key of allowed) {
    if (key in patch) out[key] = patch[key];
  }
  return out;
}

/**
 * Vessel-intrinsic fields — the properties closer to the boat's legal
 * identity (name, make/model/year, HIN, registration). The UI gates these
 * behind an explicit confirm step before calling this; that's a UX
 * friction choice, not a security boundary, so this action itself does
 * nothing different from updateVesselOwnerFields beyond the allow-list.
 */
export async function updateVesselIntrinsicFields(mxeId: string, patch: IntrinsicPatch): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) return { error: "Vessel not found." };

  const update = pickAllowed(patch, INTRINSIC_FIELDS);
  if (Object.keys(update).length === 0) return {};

  const { error } = await service.from("vessels").update(update).eq("id", vessel.id);
  if (error) return { error: error.message };
  return {};
}

/**
 * Owner-specific fields — contact info, emergency contact, storage,
 * public notes, insurance, propulsion & safety. No confirm step; the UI
 * saves these directly.
 */
export async function updateVesselOwnerFields(mxeId: string, patch: OwnerPatch): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) return { error: "Vessel not found." };

  const update = pickAllowed(patch, OWNER_FIELDS);
  if (Object.keys(update).length === 0) return {};

  const { error } = await service.from("vessels").update(update).eq("id", vessel.id);
  if (error) return { error: error.message };
  return {};
}

const DOC_COLUMN = {
  registration: "doc_registration_url",
  insurance: "doc_insurance_url",
  boater_card: "doc_boater_card_url",
} as const;

/**
 * Replaces one of the three document URLs on an already-existing vessel.
 * The upload itself (bucket, path convention, upsert-in-place) happens
 * client-side before this is called — see lib/vessel-uploads.ts. No
 * document-quota check here: nothing in this codebase currently enforces
 * the Basic-tier "+1 additional document" cap (confirmed by search), so
 * there is nothing for a replace to trip. If that cap is ever built, it
 * should key off whether the target column is currently null (an add)
 * vs. already set (a replace, which shouldn't count against it) — not
 * off this action being called.
 */
export async function updateVesselDocument(
  mxeId: string,
  docType: keyof typeof DOC_COLUMN,
  url: string,
): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) return { error: "Vessel not found." };

  const column = DOC_COLUMN[docType];
  const { error } = await service.from("vessels").update({ [column]: url }).eq("id", vessel.id);
  if (error) return { error: error.message };
  return {};
}

const LOCKED_FIELDS = ["hin", "make", "model", "year", "length_ft", "draft_ft", "engine"] as const;
type LockedField = (typeof LOCKED_FIELDS)[number];

/**
 * The owner-facing half of the support-mediated correction path for the
 * locked, identity-defining fields (see migration
 * 20260830_vessel_identity_lock_and_audit.sql for why those have no
 * direct edit path). This never writes to vessels — it only records what
 * the owner is asking for, with the required supporting document, for an
 * admin to review and apply by hand if it checks out. The eventual
 * direct-DB fix is what the identity audit trigger captures, separately.
 */
export async function submitIdentityCorrectionRequest(
  mxeId: string,
  fieldName: LockedField,
  requestedValue: string,
  documentPath: string,
  notes: string | null,
): Promise<{ error?: string }> {
  if (!LOCKED_FIELDS.includes(fieldName)) return { error: "Invalid field." };
  if (!requestedValue.trim()) return { error: "Requested value is required." };
  if (!documentPath.trim()) return { error: "A supporting document is required." };

  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select(`id, owner_id, mxe_id, ${fieldName}`)
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as ({ id: string; owner_id: string; mxe_id: string } & Record<LockedField, unknown>) | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }

  const currentValue = vessel[fieldName];

  const { error } = await service.from("vessel_identity_correction_requests").insert({
    vessel_id: vessel.id,
    mxe_id: vessel.mxe_id,
    owner_id: vessel.owner_id,
    field_name: fieldName,
    current_value: currentValue == null ? null : String(currentValue),
    requested_value: requestedValue.trim(),
    document_path: documentPath,
    notes: notes?.trim() || null,
  });
  if (error) return { error: error.message };
  return {};
}

/**
 * Creates a Stripe Billing Portal session and redirects there — Stripe's
 * hosted self-service flow (update payment method, view invoices, cancel),
 * not custom-built UI, same reasoning as using Payment Element for checkout
 * instead of a hand-rolled card form.
 */
export async function openBillingPortal(): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user?.email) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const normalizedEmail = user.email.trim().toLowerCase();
  const { data: ownerRow } = await service
    .from("users")
    .select("stripe_customer_id")
    .eq("email", normalizedEmail)
    .maybeSingle();
  const customerId = (ownerRow as { stripe_customer_id: string | null } | null)?.stripe_customer_id;

  if (!customerId) return { error: "No billing account on file yet." };

  const origin = process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://moxieyacht.com";
  const session = await getStripe().billingPortal.sessions.create({
    customer: customerId,
    return_url: `${origin.replace(/\/$/, "")}/dashboard`,
  });

  redirect(session.url);
}
