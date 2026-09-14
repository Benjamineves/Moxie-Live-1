import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";
import { getStripe } from "./stripe/server.ts";
import { cleanupVesselStorage, sweepVesselStoragePrefix } from "./vessel-storage-cleanup.ts";

/**
 * DELETING A VESSEL THAT WAS NEVER PAID FOR — THE ONLY WAY IN.
 *
 * Two callers: an owner removing an abandoned registration from their
 * dashboard, and an admin reclaiming its badge. Both come through
 * deleteUnpaidVessel, and nothing else in the app calls
 * delete_unactivated_vessel (a test enforces that).
 *
 * WHY THIS HELPER EXISTS
 *
 * delete_unactivated_vessel checks everything Postgres can see. It cannot
 * see Stripe. A payment that succeeded while its webhook never arrived
 * leaves the vessel pending_payment with no payment row — indistinguishable,
 * in the database, from a checkout nobody finished. Only Stripe knows, and
 * the function cannot make a network call.
 *
 * That check used to live in the admin action alone. The owner's delete
 * button skipped it entirely (and called a stale function that also deleted
 * the vessel's payment records). A check in one caller is not enforcement —
 * the same lesson as choose_active_vessels — so the Stripe check, the
 * database call, and the Storage cleanup are one sequence here, and a
 * caller cannot reach the delete without passing through the check.
 *
 * WHAT CALLERS STILL OWN
 *
 * Authorization. This does not know who is asking. The admin action runs
 * requireAdmin; the owner action confirms the vessel is theirs. Both must
 * do so BEFORE calling this.
 *
 * PAYMENT RECORDS
 *
 * Never destroyed here. delete_unactivated_vessel refuses (MX005) when any
 * vessel_payments row exists for the vessel, so a vessel with a recorded
 * charge is not deleted by this path at all. Since 20261001 the database
 * enforces the same thing for every path: vessel_payments and
 * ownership_history reference vessels ON DELETE RESTRICT, not CASCADE.
 */

/** Intent states that mean no money moved and none is pending. */
const HARMLESS_INTENT_STATUSES = new Set(["canceled", "requires_payment_method"]);

const MXE_RE = /^MXE-\d{5}$/;

/** More intents than this for one customer and we stop and refuse rather than guess. */
const CUSTOMER_INTENT_SCAN_LIMIT = 1000;

export type StripePaymentCheck =
  | { safe: true; detail: string }
  | { safe: false; reason: "payment_found" | "unverifiable"; detail: string };

/**
 * The decision, apart from the network, so it can be tested.
 */
export function judgePaymentIntents(intents: { id: string; status: string }[]): StripePaymentCheck {
  const alive = intents.filter((i) => !HARMLESS_INTENT_STATUSES.has(i.status));
  if (alive.length > 0) {
    return {
      safe: false,
      reason: "payment_found",
      detail: `Stripe has ${alive.length} live payment intent(s): ${alive.map((i) => `${i.id}=${i.status}`).join(", ")}`,
    };
  }
  return {
    safe: true,
    detail: intents.length === 0 ? "No payment intents in Stripe" : `${intents.length} intent(s), all canceled or unpaid`,
  };
}

/**
 * Asks Stripe whether any PaymentIntent for this MXE ID is not safely dead.
 *
 * FAILS CLOSED: if any lookup errors, times out, or cannot be completed,
 * this refuses. An unreachable API is not evidence of no payment.
 *
 * TWO LOOKUPS, because each has a blind spot the other covers:
 *  - search by metadata.mxe_id finds intents under any customer, but
 *    Stripe's search index can lag by about a minute — a payment made in
 *    that minute is invisible to it;
 *  - listing the owner's customer is a consistent read with no lag, but
 *    misses intents made under a customer id the account no longer holds
 *    (the app recreates customers Stripe has deleted).
 * Both rely on intents carrying metadata.mxe_id. Every checkout sets it at
 * creation, and the signup bundle — which can only tag its intent after
 * the subscription creates it — now withholds the client secret if that
 * tag fails, so no intent can be paid untagged.
 */
export async function checkStripeForPayments(
  mxeId: string,
  customerId: string | null,
  stripe: Pick<Stripe, "paymentIntents"> = getStripe(),
): Promise<StripePaymentCheck> {
  if (!MXE_RE.test(mxeId)) {
    // Also what makes interpolating it into the search query safe.
    return { safe: false, reason: "unverifiable", detail: `Refusing: '${mxeId}' is not a well-formed MXE ID.` };
  }
  try {
    const found = new Map<string, { id: string; status: string }>();

    const searched = await stripe.paymentIntents.search({ query: `metadata['mxe_id']:'${mxeId}'`, limit: 100 });
    if (searched.has_more) {
      return { safe: false, reason: "unverifiable", detail: "Refusing: more than 100 payment intents match this MXE ID." };
    }
    for (const i of searched.data) found.set(i.id, { id: i.id, status: i.status });

    if (customerId) {
      let scanned = 0;
      for await (const i of stripe.paymentIntents.list({ customer: customerId, limit: 100 })) {
        scanned += 1;
        if (scanned > CUSTOMER_INTENT_SCAN_LIMIT) {
          return { safe: false, reason: "unverifiable", detail: `Refusing: customer has more than ${CUSTOMER_INTENT_SCAN_LIMIT} payment intents.` };
        }
        if (i.metadata?.mxe_id === mxeId) found.set(i.id, { id: i.id, status: i.status });
      }
    }

    return judgePaymentIntents([...found.values()]);
  } catch (err) {
    return {
      safe: false,
      reason: "unverifiable",
      detail: `Stripe lookup failed — refusing. ${err instanceof Error ? err.message : "unknown error"}`,
    };
  }
}

export type UnpaidVesselDeleteActor = { kind: "admin"; email: string } | { kind: "owner"; email: string };

export type UnpaidVesselDeleteResult =
  | { ok: true; mxeId: string; storageLeftovers: string[] }
  | { ok: false; stage: "lookup"; message: string }
  | { ok: false; stage: "stripe"; check: Extract<StripePaymentCheck, { safe: false }> }
  | { ok: false; stage: "database"; code: string | null; message: string };

export async function deleteUnpaidVessel(
  service: SupabaseClient<PermissiveDatabase>,
  input: { vesselId: string; reason: string; actor: UnpaidVesselDeleteActor },
): Promise<UnpaidVesselDeleteResult> {
  const reason = input.reason.trim();
  const actorEmail = input.actor.email.trim();
  if (!reason) return { ok: false, stage: "lookup", message: "A reason is required." };
  if (!actorEmail) return { ok: false, stage: "lookup", message: "The person deleting this must be identified." };

  const { data: vesselRow, error: vesselError } = await service
    .from("vessels")
    .select("id, mxe_id, owner_id")
    .eq("id", input.vesselId)
    .maybeSingle();
  if (vesselError) return { ok: false, stage: "lookup", message: `Could not read the vessel: ${vesselError.message}` };
  const vessel = vesselRow as { id: string; mxe_id: string; owner_id: string } | null;
  if (!vessel) return { ok: false, stage: "lookup", message: "That vessel no longer exists." };

  const { data: ownerRow, error: ownerError } = await service
    .from("users")
    .select("stripe_customer_id")
    .eq("id", vessel.owner_id)
    .maybeSingle();
  // Fail closed here too: without the customer id the consistent lookup is
  // skipped, and the search alone has the one-minute blind spot.
  if (ownerError) return { ok: false, stage: "lookup", message: `Could not read the owner's account: ${ownerError.message}` };
  const customerId = (ownerRow as { stripe_customer_id: string | null } | null)?.stripe_customer_id ?? null;

  // Immediately before the delete, never from an earlier preview: a payment
  // can land between an admin looking and an admin acting, and that is the
  // window this exists for.
  const check = await checkStripeForPayments(vessel.mxe_id, customerId);
  if (!check.safe) return { ok: false, stage: "stripe", check };

  // The function's last parameter is named p_admin_email because it predates
  // owner self-delete. It is written to badge_reclaim_log.reclaimed_by, so an
  // owner is recorded with an explicit prefix and cannot be mistaken for an
  // admin in the log.
  const reclaimedBy = input.actor.kind === "owner" ? `owner:${actorEmail}` : actorEmail;
  const { data, error } = await service.rpc("delete_unactivated_vessel", {
    p_vessel_id: vessel.id,
    p_reason: reason,
    p_admin_email: reclaimedBy,
  });
  if (error) return { ok: false, stage: "database", code: error.code ?? null, message: error.message };

  // Storage after the commit, never before — see vessel-storage-cleanup.ts.
  const refs = data as { photo_url: string | null; doc_paths: (string | null)[] } | null;
  const referenced = await cleanupVesselStorage(service, { photoUrl: refs?.photo_url ?? null, docPaths: refs?.doc_paths ?? [] });
  const swept = await sweepVesselStoragePrefix(service, vessel.owner_id, vessel.mxe_id);

  return { ok: true, mxeId: vessel.mxe_id, storageLeftovers: [...referenced.leftovers, ...swept.leftovers] };
}
