"use server";

import { redirect } from "next/navigation";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";
import { normalizeStateCode } from "@/lib/us-states";
import { isDecommissionReason, type DecommissionReason } from "@/lib/vessel-decommission";
import { createTransferAndNotifyBuyer } from "@/lib/transfer-initiate";
import { deleteUnpaidVessel } from "@/lib/unpaid-vessel-delete";
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
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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
  fishing_license_expiry: string | null;
  fishing_license_lifetime: boolean | null;
  mailing_line1: string | null;
  mailing_line2: string | null;
  mailing_city: string | null;
  mailing_state: string | null;
  mailing_zip: string | null;
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
  "fishing_license_expiry",
  "fishing_license_lifetime",
  "mailing_line1",
  "mailing_line2",
  "mailing_city",
  "mailing_state",
  "mailing_zip",
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
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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
  fishing_license: "doc_fishing_license_url",
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
  fishing_license: "doc_fishing_license_filename",
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
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { ok: false, error: "You must be signed in." };

  const service = requireSupabaseServiceClient("lib/owner-actions");

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

  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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

  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user?.email) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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
): Promise<{ token?: string; error?: string; emailed?: boolean }> {
  const normalizedBuyerEmail = buyerEmail.trim().toLowerCase();
  if (!normalizedBuyerEmail || !normalizedBuyerEmail.includes("@")) {
    return { error: "Enter a valid email address." };
  }

  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id, mxe_id, vessel_name, qr_status, lifecycle_status, owner_email, owner_name")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as
    | { id: string; owner_id: string; mxe_id: string; vessel_name: string | null; qr_status: string | null; lifecycle_status: string | null; owner_email: string | null; owner_name: string | null }
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

  // Authorization is done; the rest is the same code the transfer test
  // script runs, so what is verified is what ships.
  const { token, error, emailed } = await createTransferAndNotifyBuyer({
    service,
    vessel,
    buyerEmail: normalizedBuyerEmail,
  });
  if (error) return { error };

  // `emailed` is passed back so the confirmation screen can lead with the
  // email when it went out and fall back to "send this yourself" when it
  // did not. The transfer succeeded either way — this is not an error.
  return { token, emailed };
}

/**
 * Seller can cancel any time before the transfer completes — while
 * still 'pending' (buyer hasn't accepted) or 'awaiting_payment' (buyer
 * accepted, seller hasn't paid yet). No charge has happened in either
 * state, so there's nothing to refund.
 */
export async function cancelOwnershipTransfer(transferId: string): Promise<{ error?: string }> {
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
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

/**
 * Owner-initiated hard delete, strictly for vessels that never
 * completed activation — decommission is the only removal path for an
 * activated vessel, and stays admin-mediated. The real vessel: an
 * owner fills in the intake form at a marina, gets to checkout, says
 * "let me think about it," and never pays. They shouldn't be stuck
 * with a dead entry, or have to pay just to be allowed to ask for its
 * removal.
 *
 * THIS USED TO CALL A STALE FUNCTION. delete_unactivated_vessel(p_vessel_id,
 * p_owner_id) from 20260909 survived as an overload when 20260927 added the
 * current (p_vessel_id, p_reason, p_admin_email) version, and this action
 * kept calling the old one. It checked no Stripe payment, deleted the
 * vessel's payment records along with it, never returned the badge identity
 * to stock — and, since 7a, failed with a raw foreign-key error on every
 * vessel, because badge_identities.vessel_id still pointed at it.
 *
 * It now goes through deleteUnpaidVessel, exactly as the admin reclaim does:
 * the Stripe check, then the current function (every precondition,
 * refusing rather than cascading when payment or other records exist, and
 * returning the badge to stock), then Storage. Authorization stays here —
 * the helper does not know who is asking.
 *
 * Three layers still keep this away from an activated vessel: the button
 * only renders for a vessel showing "needs activation"; this action re-checks
 * qr_status for a friendlier error; and the function is the enforcement.
 */
export async function deleteUnactivatedVessel(mxeId: string): Promise<{ error?: string }> {
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user?.email) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
  const { data: vesselRow, error: vesselError } = await service
    .from("vessels")
    .select("id, owner_id, mxe_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  if (vesselError) return { error: "Couldn't load this vessel. Please try again." };
  const vessel = vesselRow as { id: string; owner_id: string; mxe_id: string; qr_status: string | null } | null;

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    return { error: "Vessel not found." };
  }
  if (vessel.qr_status !== "pending_payment") {
    return { error: "Only a vessel that hasn't been activated yet can be deleted. Use decommission instead." };
  }

  const result = await deleteUnpaidVessel(service, {
    vesselId: vessel.id,
    reason: "Deleted by the owner before paying, from their dashboard.",
    actor: { kind: "owner", email: user.email },
  });

  if (result.ok) {
    if (result.storageLeftovers.length > 0) {
      // Not the owner's to fix, so logged for us rather than shown to them.
      console.error(`[delete-vessel] ${result.mxeId} deleted, but Storage cleanup left: ${result.storageLeftovers.join("; ")}`);
    }
    return {};
  }

  // Owner-facing wording. Every one of these leaves the vessel in place.
  if (result.stage === "stripe") {
    console.error(`[delete-vessel] ${vessel.mxe_id} refused by the Stripe check: ${result.check.detail}`);
    return {
      error:
        result.check.reason === "payment_found"
          ? "There's a payment on record for this vessel, so it can't be deleted here. Contact Moxie and we'll sort it out."
          : "We couldn't confirm with our payment provider that this vessel was never paid for, so it hasn't been deleted. Please try again shortly.",
    };
  }
  if (result.stage === "database") {
    console.error(`[delete-vessel] ${vessel.mxe_id} refused by delete_unactivated_vessel [${result.code}]: ${result.message}`);
    switch (result.code) {
      case "MX002":
      case "MX003":
        return { error: "This vessel has been activated, so it can't be deleted. Use decommission instead." };
      case "MX005":
        return { error: "This vessel has a payment or other records attached, so it can't be deleted here. Contact Moxie." };
      case "MX007":
        return { error: "A badge has already been ordered for this vessel, so it can't be deleted here. Contact Moxie." };
      default:
        return { error: "This vessel couldn't be deleted. Contact Moxie and we'll take care of it." };
    }
  }
  return { error: result.message };
}

/**
 * Dismisses one in-app notification (lib/notify.ts's notifyOwner() /
 * owner_notifications) — marks it read, doesn't delete it. Scoped to
 * ownerIds so this can't mark another account's notification read by
 * guessing an id.
 */
export async function dismissNotification(notificationId: string): Promise<{ error?: string }> {
  const authClient = await requireSupabaseServerClient("lib/owner-actions");

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("/lib/owner-actions");
  const { error } = await service
    .from("owner_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", notificationId)
    .in("owner_id", ownerIds);
  if (error) return { error: error.message };
  return {};
}
