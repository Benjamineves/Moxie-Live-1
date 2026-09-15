import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { TIER_RECONCILIATION_EXEMPT, isTierReconciliationExempt } from "./billing-exempt.ts";

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), "utf8");

const ADMIN = "2255a040-7300-407c-bc31-7fb35b383d14";

test("the admin account set by hand is exempt, and nothing else is", () => {
  assert.equal(isTierReconciliationExempt(ADMIN), true);
  // The other active accounts in the live database on 2026-09-15 all pay through Stripe.
  for (const id of ["90806ee6-7f4d-4f17-aa7a-894e9fdb07d1", "00000000-0000-0000-0000-000000000001", "0a5267af-39f3-4ed7-96cf-ba6b8ca6bf9e"]) {
    assert.equal(isTierReconciliationExempt(id), false, id);
  }
  assert.equal(isTierReconciliationExempt(null), false);
  assert.equal(isTierReconciliationExempt(""), false);
  assert.equal(TIER_RECONCILIATION_EXEMPT.length, 1);
});

test("every place that syncs an account's plan from Stripe checks the exemption", () => {
  const webhook = read("../app/api/stripe/webhook/route.ts");
  const invoicePaid = webhook.slice(webhook.indexOf("async function recordAccountSubscriptionInvoice"), webhook.indexOf("async function syncSubscriptionStatus"));
  const statusSync = webhook.slice(webhook.indexOf("async function syncSubscriptionStatus"));
  // Before the account update in invoice.paid.
  assert.ok(invoicePaid.indexOf("isTierReconciliationExempt(") >= 0, "invoice.paid must check the exemption");
  assert.ok(invoicePaid.indexOf("isTierReconciliationExempt(") < invoicePaid.indexOf('.from("users")\n      .update('), "invoice.paid: exemption before the account update");
  // Before the first write of the status sync.
  const check = statusSync.indexOf("isTierReconciliationExempt(");
  assert.ok(check >= 0, "status sync must check the exemption");
  for (const branch of ['action.kind === "lapse"', 'action.kind === "past_due"', 'action.kind === "active"']) {
    assert.ok(check < statusSync.indexOf(branch), `status sync: exemption before ${branch}`);
  }
  const upgrade = webhook.slice(webhook.indexOf("async function completeTierUpgrade"), webhook.indexOf("async function recordAccountSubscriptionInvoice"));
  assert.ok(upgrade.indexOf("isTierReconciliationExempt(") >= 0, "tier upgrade must check the exemption");
  assert.ok(upgrade.indexOf("isTierReconciliationExempt(") < upgrade.indexOf('update({ subscription_tier: "full" })'), "tier upgrade: exemption before writing Full");
  assert.match(read("./dormancy-notify.ts"), /!isTierReconciliationExempt\(ownerId\)/, "grace notifier must not ask Stripe for an exempt account");
});
