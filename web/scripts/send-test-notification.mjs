/**
 * ONE live test notification, through the real send path.
 *
 *   node --experimental-strip-types scripts/send-test-notification.mjs
 *
 * Calls notifyOwner exactly once. Nothing here constructs a message by
 * hand — the point is to exercise what production does: the policy map,
 * dedup, recipient resolution, template rendering, and the Resend call.
 *
 * Guarded so it cannot send to the wrong person or send twice:
 *  - refuses unless RESEND_API_KEY is present
 *  - refuses unless the resolved recipient is exactly the expected address
 *  - one call, no loop, no batch
 */
import { createClient } from "@supabase/supabase-js";
import { notifyOwner } from "../src/lib/notify.ts";
import { getOwnerEmailByUserId } from "../src/lib/owner-verify.ts";

const EXPECTED_RECIPIENT = "admin@moxieyachting.com";
const OWNER_ID = "2255a040-7300-407c-bc31-7fb35b383d14";

if (!process.env.RESEND_API_KEY?.trim()) {
  console.error("RESEND_API_KEY is not set. Email would be silently disabled and this test would prove nothing.");
  process.exit(1);
}

const resolved = await getOwnerEmailByUserId(OWNER_ID);
if (resolved !== EXPECTED_RECIPIENT) {
  console.error(`Recipient guard: owner ${OWNER_ID} resolves to ${resolved}, expected ${EXPECTED_RECIPIENT}. Refusing.`);
  process.exit(1);
}
console.log(`recipient resolved through getOwnerEmailByUserId: ${resolved}`);

const service = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
const before = await service
  .from("owner_notifications")
  .select("id", { count: "exact", head: true })
  .eq("owner_id", OWNER_ID)
  .eq("type", "subscription_past_due");
console.log(`owner_notifications rows for this owner+type before: ${before.count}`);

console.log("\n--- notifyOwner (one call) ---");
await notifyOwner(
  OWNER_ID,
  "subscription_past_due",
  "Your last payment didn't go through. You have 7 days to update your payment method before your vessels' document access, sharing, and editing pause.",
);
console.log("--- notifyOwner resolved ---\n");

const after = await service
  .from("owner_notifications")
  .select("id, created_at", { count: "exact" })
  .eq("owner_id", OWNER_ID)
  .eq("type", "subscription_past_due")
  .order("created_at", { ascending: false });
console.log(`owner_notifications rows after: ${after.count}`);
for (const r of after.data ?? []) console.log(`  row ${r.id} created ${r.created_at}`);
