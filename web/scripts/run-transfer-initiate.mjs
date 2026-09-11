/**
 * ONE live transfer initiation, through the shipped code path.
 *
 * Calls createTransferAndNotifyBuyer — the same function
 * initiateOwnershipTransfer calls once it has authorized the seller.
 * Nothing here reimplements it, so what this verifies is what runs in
 * production.
 *
 * What it does NOT cover: the server action's authorization gate
 * (session, ownership, vessel state, no transfer already in flight),
 * which needs a signed-in browser session.
 *
 * Guards: refuses without a key, refuses on an unexpected buyer address,
 * refuses if the vessel already has a transfer in flight. One call.
 */
import { createClient } from "@supabase/supabase-js";
import { createTransferAndNotifyBuyer } from "../src/lib/transfer-initiate.ts";

const EXPECTED_BUYER = "moxieyachting@gmail.com";
const MXE = "MXE-01024";

if (!process.env.RESEND_API_KEY?.trim()) {
  console.error("RESEND_API_KEY is not set — the email would be silently skipped and this would prove nothing.");
  process.exit(1);
}

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data: vesselRow } = await service
  .from("vessels")
  .select("id, mxe_id, vessel_name, owner_id, owner_email, owner_name, qr_status, lifecycle_status")
  .eq("mxe_id", MXE)
  .maybeSingle();
if (!vesselRow) { console.error(`No vessel ${MXE}.`); process.exit(1); }

// The same preconditions the server action enforces, restated here
// because this path bypasses it.
if (vesselRow.qr_status !== "active" || vesselRow.lifecycle_status === "decommissioned") {
  console.error(`${MXE} is not transferable (qr=${vesselRow.qr_status}, life=${vesselRow.lifecycle_status}).`);
  process.exit(1);
}
if ((vesselRow.owner_email ?? "").toLowerCase() === EXPECTED_BUYER) {
  console.error("Buyer is the current owner. Refusing.");
  process.exit(1);
}
const { data: inFlight } = await service
  .from("ownership_transfers")
  .select("id")
  .eq("vessel_id", vesselRow.id)
  .in("status", ["pending", "awaiting_payment"])
  .maybeSingle();
if (inFlight) { console.error(`${MXE} already has a transfer in flight (${inFlight.id}). Refusing.`); process.exit(1); }

console.log(`vessel:  ${vesselRow.mxe_id} "${vesselRow.vessel_name}"`);
console.log(`seller:  ${vesselRow.owner_name ?? "(no name)"} <${vesselRow.owner_email ?? "none"}>`);
console.log(`buyer:   ${EXPECTED_BUYER}\n`);

console.log("--- createTransferAndNotifyBuyer (one call) ---");
const result = await createTransferAndNotifyBuyer({
  service,
  vessel: vesselRow,
  buyerEmail: EXPECTED_BUYER,
});
console.log("--- returned ---");
console.log(`  transferId: ${result.transferId ?? "none"}`);
console.log(`  token:      ${result.token ? result.token.slice(0, 6) + "… (" + result.token.length + " chars)" : "none"}`);
console.log(`  emailed:    ${result.emailed === true ? "yes" : `no (${result.emailFailureReason ?? "unknown"})`}`);
if (result.error) console.log(`  error:      ${result.error}`);
