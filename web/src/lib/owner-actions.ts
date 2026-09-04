"use server";

import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";
import { normalizeStateCode } from "@/lib/us-states";
import { isDecommissionReason, type DecommissionReason } from "@/lib/vessel-decommission";
import { generateShareToken } from "@/lib/share-token";
import { TRANSFER_EXPIRY_DAYS } from "@/lib/vessel-transfer";
import { FULL_STORAGE_CAP_BYTES } from "@/lib/tier-config";
import { getAccountStorageUsageBytes } from "@/lib/storage-usage";

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
  storage_state: string | null;
  storage_city: string | null;
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
  "storage_state",
  "storage_city",
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

  // Same validation the intake action applies — storage_state feeds
  // geographic reporting, so the edit path can't be the hole that lets
  // an arbitrary string into that column. Clearing it is allowed.
  if ("storage_state" in update) {
    const raw = update.storage_state;
    if (raw != null && raw !== "") {
      const normalized = normalizeStateCode(raw);
      if (!normalized) return { error: "Invalid storage state." };
      update.storage_state = normalized;
    } else {
      update.storage_state = null;
    }
  }

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
 * Original-filename companions to DOC_COLUMN
 * (20260918_document_original_filenames.sql). Written together with the
 * path, always — the path is deterministic and identical across vessels,
 * so this is the only record of what the owner actually uploaded.
 */
const DOC_FILENAME_COLUMN = {
  registration: "doc_registration_filename",
  insurance: "doc_insurance_filename",
  boater_card: "doc_boater_card_filename",
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
  fileName?: string | null,
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
  // Replacing a document always rewrites its filename too, including to
  // NULL when the caller has none to give — leaving the previous
  // document's name attached to a new file's bytes would be worse than
  // showing no name at all.
  const update: Record<string, string | null> = {
    [column]: url,
    [DOC_FILENAME_COLUMN[docType]]: fileName?.trim() || null,
  };
  const { error } = await service.from("vessels").update(update).eq("id", vessel.id);
  if (error) return { error: error.message };
  return {};
}

/**
 * Pre-upload check for the Full-tier 500MB account storage cap
 * (FULL_STORAGE_CAP_BYTES, lib/tier-config.ts) — called from the client
 * BEFORE the browser starts the actual Storage upload, since that upload
 * goes straight to Supabase Storage and never passes through a server
 * action of its own. Basic tier has no byte cap (it's capped by document
 * count instead — BASIC_DOCUMENT_LIMIT), so this is a no-op there.
 */
export async function checkStorageCapacity(incomingBytes: number): Promise<{ ok: true } | { ok: false; error: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { ok: false, error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { ok: false, error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { ok: false, error: "Missing Supabase service role configuration." };

  const { data: ownerRow } = await service
    .from("users")
    .select("subscription_tier")
    .in("id", ownerIds)
    .eq("subscription_tier", "full")
    .maybeSingle();

  if (!ownerRow) return { ok: true };

  const { data: vesselRows } = await service.from("vessels").select("mxe_id").in("owner_id", ownerIds);
  const mxeIds = (vesselRows ?? []).map((v) => (v as { mxe_id: string }).mxe_id);

  const currentBytes = await getAccountStorageUsageBytes(service, ownerIds, mxeIds);

  if (currentBytes + incomingBytes > FULL_STORAGE_CAP_BYTES) {
    const currentMb = (currentBytes / (1024 * 1024)).toFixed(0);
    const capMb = (FULL_STORAGE_CAP_BYTES / (1024 * 1024)).toFixed(0);
    return { ok: false, error: `This would put your account over its ${capMb}MB storage limit (currently using ${currentMb}MB).` };
  }

  return { ok: true };
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
 * Owner-facing half of the decommission/archive flow — this never writes
 * lifecycle_status itself, only records the request for an admin to
 * review. Approval (apply_vessel_decommission) is what actually applies
 * the status change, atomically, along with revoking active shares.
 *
 * Blocks a second pending request for the same vessel rather than
 * silently allowing duplicates to pile up in the admin queue — a
 * re-submission is a more consequential mistake to make twice than most
 * of the other request-style flows in this app.
 */
export async function submitDecommissionRequest(
  mxeId: string,
  reason: DecommissionReason,
  notes: string | null,
): Promise<{ error?: string }> {
  if (!isDecommissionReason(reason)) return { error: "Invalid reason." };

  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id, mxe_id, lifecycle_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as { id: string; owner_id: string; mxe_id: string; lifecycle_status: string | null } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }
  if (vessel.lifecycle_status === "decommissioned") {
    return { error: "This vessel is already decommissioned." };
  }

  const { data: existingPending } = await service
    .from("vessel_decommission_requests")
    .select("id")
    .eq("vessel_id", vessel.id)
    .eq("status", "pending")
    .maybeSingle();
  if (existingPending) {
    return { error: "A decommission request for this vessel is already pending review." };
  }

  const { error } = await service.from("vessel_decommission_requests").insert({
    vessel_id: vessel.id,
    mxe_id: vessel.mxe_id,
    owner_id: vessel.owner_id,
    reason,
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

/**
 * Seller-side half of Ownership Transfer: creates the pending request
 * and returns a one-time link token — the same generateShareToken()/
 * hashShareToken() pair vessel_shares already uses, only the hash is
 * ever persisted. No charge happens here; the fee is only ever due once
 * the buyer accepts (see dashboard/transfer/[transferId]/payment).
 *
 * initiated_by/initiated_via are set to the seller themselves here —
 * this action is the v1, owner-session-only caller. A future escrow API
 * would call the same underlying insert with a different actor; nothing
 * about "must be the current owner" is baked into the schema or the
 * atomic accept/complete/reverse functions, only into this function's
 * own auth check.
 */
export async function initiateOwnershipTransfer(
  mxeId: string,
  buyerEmail: string,
): Promise<{ token?: string; error?: string }> {
  const normalizedBuyerEmail = buyerEmail.trim().toLowerCase();
  if (!normalizedBuyerEmail || !normalizedBuyerEmail.includes("@")) {
    return { error: "Enter a valid email address." };
  }

  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id, mxe_id, qr_status, lifecycle_status, owner_email")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as
    | { id: string; owner_id: string; mxe_id: string; qr_status: string | null; lifecycle_status: string | null; owner_email: string | null }
    | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }
  if (vessel.qr_status !== "active") {
    return { error: "This vessel needs to finish activating before it can be transferred." };
  }
  if (vessel.lifecycle_status === "decommissioned") {
    return { error: "This vessel is decommissioned and can't be transferred." };
  }
  if (vessel.owner_email && vessel.owner_email.trim().toLowerCase() === normalizedBuyerEmail) {
    return { error: "You can't transfer a vessel to yourself." };
  }

  const { data: existingActive } = await service
    .from("ownership_transfers")
    .select("id")
    .eq("vessel_id", vessel.id)
    .in("status", ["pending", "awaiting_payment"])
    .maybeSingle();
  if (existingActive) {
    return { error: "A transfer for this vessel is already in progress. Cancel it first to start a new one." };
  }

  const { token, tokenHash } = generateShareToken();
  const expiresAt = new Date(Date.now() + TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const { error } = await service.from("ownership_transfers").insert({
    vessel_id: vessel.id,
    mxe_id: vessel.mxe_id,
    seller_id: vessel.owner_id,
    initiated_by: vessel.owner_id,
    initiated_via: "owner",
    buyer_email: normalizedBuyerEmail,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
  });
  if (error) return { error: error.message };

  return { token };
}

/**
 * Seller can cancel any time before the transfer completes — while
 * still 'pending' (buyer hasn't accepted) or 'awaiting_payment' (buyer
 * accepted, seller hasn't paid yet). No charge has happened in either
 * state, so there's nothing to refund.
 */
export async function cancelOwnershipTransfer(transferId: string): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, seller_id, status")
    .eq("id", transferId)
    .maybeSingle();
  const transfer = transferRow as { id: string; seller_id: string; status: string } | null;

  if (!transfer || !ownerIds.includes(transfer.seller_id)) {
    return { error: "Transfer not found." };
  }
  if (transfer.status !== "pending" && transfer.status !== "awaiting_payment") {
    return { error: `This transfer can't be canceled (status: ${transfer.status}).` };
  }

  const { error } = await service
    .from("ownership_transfers")
    .update({ status: "canceled", canceled_at: new Date().toISOString() })
    .eq("id", transferId)
    .in("status", ["pending", "awaiting_payment"]);
  if (error) return { error: error.message };
  return {};
}

const UPLOAD_BUCKETS = ["vessel-photos", "vessel-docs"] as const;

/**
 * Every file this vessel could have — photo, registration, insurance,
 * correction-request attachments — lives under this one prefix in
 * either bucket (see vessel-uploads.ts's path convention). Walking one
 * level of subfolders (e.g. correction-requests/) catches everything
 * without needing to know every possible filename in advance, same
 * approach reset_test_vessel_files.mjs already uses for the same
 * reason.
 */
async function collectVesselStoragePaths(
  service: NonNullable<ReturnType<typeof createSupabaseServiceClient>>,
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const { data: entries } = await service.storage.from(bucket).list(prefix, { limit: 1000 });
  const paths: string[] = [];
  for (const entry of entries ?? []) {
    if (entry.id === null) {
      // A folder (no object metadata) — one level deep is as far as
      // this convention ever nests.
      const { data: nested } = await service.storage.from(bucket).list(`${prefix}/${entry.name}`, { limit: 1000 });
      for (const file of nested ?? []) {
        if (file.id !== null) paths.push(`${prefix}/${entry.name}/${file.name}`);
      }
    } else {
      paths.push(`${prefix}/${entry.name}`);
    }
  }
  return paths;
}

/**
 * Owner-initiated hard delete, strictly for vessels that never
 * completed activation — decommission is the only removal path for an
 * activated vessel, and stays admin-mediated. The real vessel: an
 * owner fills in the intake form at a marina, gets to checkout, says
 * "let me think about it," and never pays. They shouldn't be stuck
 * with a dead entry, or have to pay just to be allowed to ask for its
 * removal.
 *
 * Three independent layers confirm this can never reach an activated
 * vessel: the UI trigger only renders when the vessel is already
 * showing "needs activation"; this action re-checks qr_status before
 * attempting anything (a friendlier, earlier error); and
 * delete_unactivated_vessel itself re-verifies the same precondition
 * again and is the actual enforcement point, same as every other
 * mutating function this session (never trust the caller).
 *
 * The DB deletion runs first, atomically, via that function — that's
 * the moment the vessel legally stops existing. Storage cleanup is a
 * separate, best-effort step after: Postgres has no access to Supabase
 * Storage's API, so it can't participate in that transaction. If a
 * storage delete fails here, the vessel is still correctly gone from
 * the database — a stray orphaned file is a minor, recoverable loose
 * end, not a broken vessel record, so this never turns a storage
 * hiccup into a user-facing failure.
 */
export async function deleteUnactivatedVessel(mxeId: string): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id, mxe_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as { id: string; owner_id: string; mxe_id: string; qr_status: string | null } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }
  if (vessel.qr_status !== "pending_payment") {
    return { error: "Only a vessel that hasn't been activated yet can be deleted. Use decommission instead." };
  }

  const { error } = await service.rpc("delete_unactivated_vessel", {
    p_vessel_id: vessel.id,
    p_owner_id: vessel.owner_id,
  });
  if (error) return { error: error.message };

  // Best-effort from here — the vessel is already gone in the database
  // regardless of what happens below.
  try {
    for (const bucket of UPLOAD_BUCKETS) {
      const paths = await collectVesselStoragePaths(service, bucket, `${vessel.owner_id}/${vessel.mxe_id}`);
      if (paths.length > 0) {
        const { error: removeError } = await service.storage.from(bucket).remove(paths);
        if (removeError) {
          console.error(`[delete-vessel] Failed to remove ${paths.length} file(s) from ${bucket} for ${vessel.mxe_id}:`, removeError);
        }
      }
    }
  } catch (err) {
    console.error(`[delete-vessel] Storage cleanup failed for ${vessel.mxe_id}:`, err);
  }

  return {};
}

/**
 * Dismisses one in-app notification (lib/notify.ts's notifyOwner() /
 * owner_notifications) — marks it read, doesn't delete it. Scoped to
 * ownerIds so this can't mark another account's notification read by
 * guessing an id.
 */
export async function dismissNotification(notificationId: string): Promise<{ error?: string }> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service
    .from("owner_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .in("owner_id", ownerIds);
  if (error) return { error: error.message };
  return {};
}
