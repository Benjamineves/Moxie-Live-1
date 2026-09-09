"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getStripe } from "@/lib/stripe/server";

/**
 * Reclaiming a badge from a checkout that was never completed (spec
 * §3.1 note, 20260927).
 *
 * The database function holds every precondition it can check. This
 * action adds the one it cannot: whether Stripe knows about a payment
 * Postgres does not.
 */

export type ReclaimPreview = {
  vesselId: string;
  mxeId: string;
  vesselName: string | null;
  ownerEmail: string | null;
  createdAt: string | null;
  checks: { label: string; ok: boolean; detail: string }[];
  eligible: boolean;
};

export type ReclaimResult = { ok?: true; mxeId?: string; warning?: string; error?: string };

/** Intent states that mean no money moved and none is pending. */
const HARMLESS_INTENT_STATUSES = new Set(["canceled", "requires_payment_method"]);

/**
 * Asks Stripe whether any PaymentIntent exists for this MXE ID that is
 * not safely dead.
 *
 * FAILS CLOSED, deliberately and on Ben's instruction: if the lookup
 * errors, times out, or the client cannot even be constructed, this
 * refuses. An unreachable API is not evidence of no payment — and the
 * whole reason this check exists is that the database cannot tell an
 * abandoned checkout from a successful payment whose webhook never
 * arrived. Treating an outage as "probably fine" would reintroduce
 * exactly the case the check was added to close.
 */
async function stripeSaysNoPayment(mxeId: string): Promise<{ safe: boolean; detail: string }> {
  try {
    const stripe = getStripe();
    const found = await stripe.paymentIntents.search({
      query: `metadata['mxe_id']:'${mxeId}'`,
      limit: 20,
    });

    const alive = found.data.filter((intent) => !HARMLESS_INTENT_STATUSES.has(intent.status));
    if (alive.length > 0) {
      const summary = alive.map((i) => `${i.id}=${i.status}`).join(", ");
      return { safe: false, detail: `Stripe has ${alive.length} live payment intent(s): ${summary}` };
    }

    return {
      safe: true,
      detail:
        found.data.length === 0
          ? "No payment intents in Stripe"
          : `${found.data.length} intent(s), all canceled or unpaid`,
    };
  } catch (err) {
    return {
      safe: false,
      detail: `Stripe lookup failed — refusing. ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

/**
 * Everything the confirmation screen shows, so an admin sees WHY a
 * vessel is or is not eligible before acting rather than discovering it
 * from a refusal.
 *
 * These are a mirror of the function's checks, not the checks
 * themselves. The function refuses regardless of what this returns; if
 * the two ever disagree, the function wins and this is the thing that is
 * wrong.
 */
export async function previewReclaim(mxeId: string): Promise<ReclaimPreview | { error: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const normalized = mxeId.trim().toUpperCase();
  if (!/^MXE-\d{5}$/.test(normalized)) return { error: "Enter a full MXE ID, e.g. MXE-01023." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select(
      "id, mxe_id, vessel_name, owner_email, created_at, qr_status, qr_generated_at, lifecycle_status, sticker_order_status, badge_identity_id",
    )
    .eq("mxe_id", normalized)
    .maybeSingle();

  if (!vesselRow) return { error: `No vessel with MXE ID ${normalized}.` };
  const v = vesselRow as {
    id: string; mxe_id: string; vessel_name: string | null; owner_email: string | null;
    created_at: string | null; qr_status: string | null; qr_generated_at: string | null;
    lifecycle_status: string | null; sticker_order_status: string | null; badge_identity_id: string | null;
  };

  const related: string[] = [];
  for (const table of [
    "vessel_payments",
    "ownership_history",
    "vessel_shares",
    "vessel_identity_correction_requests",
    "vessel_identity_audit_log",
    "vessel_decommission_requests",
    "ownership_transfers",
    "owner_notifications",
  ]) {
    const { count } = await service.from(table).select("id", { count: "exact", head: true }).eq("vessel_id", v.id);
    if ((count ?? 0) > 0) related.push(`${table}=${count}`);
  }

  let identityDetail = "No badge identity assigned";
  let identityOk = false;
  if (v.badge_identity_id) {
    const { data: idRow } = await service
      .from("badge_identities")
      .select("mxe_id, status, vessel_id")
      .eq("id", v.badge_identity_id)
      .maybeSingle();
    const i = idRow as { mxe_id: string; status: string; vessel_id: string | null } | null;
    identityOk = !!i && i.status === "assigned" && i.vessel_id === v.id;
    identityDetail = i ? `${i.mxe_id} status=${i.status}, linked ${i.vessel_id === v.id ? "correctly" : "elsewhere"}` : "Identity row missing";
  }

  const stripe = await stripeSaysNoPayment(v.mxe_id);

  const checks: ReclaimPreview["checks"] = [
    { label: "Awaiting payment", ok: v.qr_status === "pending_payment", detail: `qr_status = ${v.qr_status ?? "null"}` },
    { label: "Never activated", ok: v.qr_generated_at === null, detail: v.qr_generated_at ? `activated ${v.qr_generated_at}` : "qr_generated_at is null" },
    { label: "Lifecycle active", ok: v.lifecycle_status === "active", detail: `lifecycle_status = ${v.lifecycle_status ?? "null"}` },
    { label: "No badge ordered", ok: (v.sticker_order_status ?? "not_ordered") === "not_ordered", detail: `sticker_order_status = ${v.sticker_order_status ?? "not_ordered"}` },
    { label: "Nothing references it", ok: related.length === 0, detail: related.length ? related.join(", ") : "all eight tables empty" },
    { label: "Badge link consistent", ok: identityOk, detail: identityDetail },
    { label: "Stripe shows no payment", ok: stripe.safe, detail: stripe.detail },
  ];

  return {
    vesselId: v.id,
    mxeId: v.mxe_id,
    vesselName: v.vessel_name,
    ownerEmail: v.owner_email,
    createdAt: v.created_at,
    checks,
    eligible: checks.every((c) => c.ok),
  };
}

/**
 * One vessel, by id, with a reason. There is no array form and no
 * "reclaim all" — a destructive operation that cannot be fired in bulk
 * is one that cannot be fired in bulk by accident.
 */
export async function reclaimUnactivatedVessel(
  vesselId: string,
  mxeIdConfirmation: string,
  reason: string,
): Promise<ReclaimResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const trimmedReason = reason.trim();
  if (!trimmedReason) return { error: "A reason is required." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, mxe_id")
    .eq("id", vesselId)
    .maybeSingle();
  if (!vesselRow) return { error: "That vessel no longer exists." };
  const vessel = vesselRow as { id: string; mxe_id: string };

  // Typed confirmation, checked server-side rather than only in the
  // browser — the friction is the point, and friction that only exists
  // in a component is friction a second caller does not have.
  if (mxeIdConfirmation.trim().toUpperCase() !== vessel.mxe_id) {
    return { error: `Confirmation did not match. Type ${vessel.mxe_id} exactly.` };
  }

  // Re-run immediately before acting rather than trusting the preview
  // the admin looked at, which may be minutes old — a payment can land
  // in that window, and that is the exact window this guards.
  const stripe = await stripeSaysNoPayment(vessel.mxe_id);
  if (!stripe.safe) return { error: `Refused: ${stripe.detail}` };

  const { data, error } = await service.rpc("delete_unactivated_vessel", {
    p_vessel_id: vesselId,
    p_reason: trimmedReason,
    p_admin_email: admin.email,
  });

  if (error) return { error: `[${error.code}] ${error.message}` };

  // Storage cleanup runs AFTER the transaction commits, and cannot join
  // it — a Storage delete is an external side effect. This order is
  // deliberate: a deleted vessel with files left over is recoverable by
  // hand, whereas files deleted from a vessel whose delete then failed
  // is a live record with missing documents.
  const result = data as { mxe_id: string; photo_url: string | null; doc_paths: (string | null)[] } | null;
  const leftovers: string[] = [];

  const docPaths = (result?.doc_paths ?? []).filter((p): p is string => !!p);
  if (docPaths.length > 0) {
    const { error: docErr } = await service.storage.from("vessel-docs").remove(docPaths);
    if (docErr) leftovers.push(`documents (${docErr.message})`);
  }

  // photo_url is a public URL with a cache-bust token, not a path — the
  // object key has to be recovered from it.
  if (result?.photo_url) {
    const match = result.photo_url.match(/\/vessel-photos\/(.+?)(\?|$)/);
    if (match) {
      const { error: photoErr } = await service.storage.from("vessel-photos").remove([decodeURIComponent(match[1])]);
      if (photoErr) leftovers.push(`photo (${photoErr.message})`);
    } else {
      leftovers.push("photo (could not derive object path from URL)");
    }
  }

  revalidatePath("/admin/badges");
  revalidatePath("/admin/stickers");
  revalidatePath("/admin");

  if (leftovers.length > 0) {
    console.error(
      `[reclaim] ${vessel.mxe_id} reclaimed, but Storage cleanup failed for: ${leftovers.join("; ")}. These objects need removing by hand.`,
    );
    return {
      ok: true,
      mxeId: vessel.mxe_id,
      warning: `Badge reclaimed, but some files could not be deleted: ${leftovers.join("; ")}. They need removing by hand.`,
    };
  }

  return { ok: true, mxeId: vessel.mxe_id };
}
