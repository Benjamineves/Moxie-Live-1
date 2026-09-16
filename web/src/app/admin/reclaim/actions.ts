"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { checkStripeForPayments, deleteUnpaidVessel } from "@/lib/unpaid-vessel-delete";

/**
 * Reclaiming a badge from a checkout that was never completed (spec
 * §3.1 note, 20260927).
 *
 * The database function holds every precondition it can check. The one it
 * cannot — whether Stripe knows about a payment Postgres does not — lives
 * in lib/unpaid-vessel-delete.ts, which the owner's delete button goes
 * through too. It used to live here, in this action alone.
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

  const service = requireSupabaseServiceClient("/app/admin/reclaim/actions");
  const normalized = mxeId.trim().toUpperCase();
  if (!/^MXE-\d{5}$/.test(normalized)) return { error: "Enter a full MXE ID, e.g. MXE-01023." };

  const { data: vesselRow } = await service
    .from("vessels")
    .select(
      "id, mxe_id, owner_id, vessel_name, owner_email, created_at, qr_status, qr_generated_at, lifecycle_status, sticker_order_status, badge_identity_id",
    )
    .eq("mxe_id", normalized)
    .maybeSingle();

  if (!vesselRow) return { error: `No vessel with MXE ID ${normalized}.` };
  const v = vesselRow as {
    id: string; mxe_id: string; owner_id: string; vessel_name: string | null; owner_email: string | null;
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

  // Display only — deleteUnpaidVessel runs the same check again at the
  // moment of deleting, and that one is the control.
  const { data: previewOwner } = await service.from("users").select("stripe_customer_id").eq("id", v.owner_id).maybeSingle();
  const stripe = await checkStripeForPayments(
    v.mxe_id,
    (previewOwner as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null,
  );

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

  const service = requireSupabaseServiceClient("/app/admin/reclaim/actions");
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

  // The Stripe check, the delete and the Storage cleanup, in that order,
  // re-run now rather than trusting the preview the admin looked at.
  const result = await deleteUnpaidVessel(service, {
    vesselId,
    reason: trimmedReason,
    actor: { kind: "admin", email: admin.email },
  });

  if (!result.ok) {
    if (result.stage === "stripe") return { error: `Refused: ${result.check.detail}` };
    if (result.stage === "database") return { error: `[${result.code}] ${result.message}` };
    return { error: result.message };
  }
  const leftovers = result.storageLeftovers;

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
