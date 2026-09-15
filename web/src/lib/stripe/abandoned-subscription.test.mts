import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { decideStoredSubscription } from "./abandoned-subscription.ts";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../app/${path}`, import.meta.url)), "utf8");

test("nothing on file proceeds without touching Stripe", () => {
  assert.equal(decideStoredSubscription(null, null), "proceed");
});

test("an abandoned first invoice is cancelled, a dead one is only cleared", () => {
  assert.equal(decideStoredSubscription("sub_1", "incomplete"), "cancel_and_clear");
  assert.equal(decideStoredSubscription("sub_1", "incomplete_expired"), "clear");
  assert.equal(decideStoredSubscription("sub_1", "canceled"), "clear");
  // Stored id Stripe can't find.
  assert.equal(decideStoredSubscription("sub_1", null), "clear");
});

test("a subscription that is or can become live refuses a second one", () => {
  for (const status of ["active", "past_due", "unpaid", "trialing", "paused"] as const) {
    assert.equal(decideStoredSubscription("sub_1", status), "refuse", status);
  }
});

test("every action that creates a plan subscription releases the stored one first", () => {
  // The plan picker used to overwrite stripe_subscription_id without
  // looking at it, orphaning the previous subscription.
  for (const path of ["dashboard/[mxeId]/payment/actions.ts", "dashboard/upgrade/actions.ts"]) {
    const text = source(path);
    const creates = [...text.matchAll(/stripe\.subscriptions\.create\(/g)];
    assert.ok(creates.length > 0, `${path}: expected a subscriptions.create`);
    for (const create of creates) {
      const before = text.slice(0, create.index);
      const lastFn = before.lastIndexOf("export async function ");
      assert.match(
        before.slice(lastFn),
        /releaseAbandonedSubscription\(stripe, service, owner\)/,
        `${path}: subscriptions.create at offset ${create.index} is not preceded by releaseAbandonedSubscription in its function`,
      );
    }
  }
});
