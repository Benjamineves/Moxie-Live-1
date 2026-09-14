import { test } from "node:test";
import assert from "node:assert/strict";
import { decideSubscriptionSync } from "./subscription-sync.ts";

test("acts on the current status, whatever the event said", () => {
  // The handler passes Stripe's current status in, not the event's. This
  // is the case that makes a late retry of an "active" event safe: by the
  // time it is processed the subscription is cancelled, so it lapses.
  assert.deepEqual(decideSubscriptionSync({ currentStatus: "canceled", otherSubscriptions: [] }), { kind: "lapse" });
});

test("maps each live and ended status to its action", () => {
  assert.deepEqual(decideSubscriptionSync({ currentStatus: "active", otherSubscriptions: [] }), { kind: "active" });
  assert.deepEqual(decideSubscriptionSync({ currentStatus: "past_due", otherSubscriptions: [] }), { kind: "past_due" });
  assert.deepEqual(decideSubscriptionSync({ currentStatus: "unpaid", otherSubscriptions: [] }), { kind: "lapse" });
});

test("an ended subscription cannot lapse an account another subscription is paying for", () => {
  // The resubscribe case: sub_old is cancelled, sub_new is active, and a
  // late or retried event for sub_old arrives. Account writes are scoped by
  // customer, so without this the new subscription's owner would be lapsed.
  const d = decideSubscriptionSync({
    currentStatus: "canceled",
    otherSubscriptions: [{ id: "sub_new", status: "active" }],
  });
  assert.deepEqual(d, { kind: "superseded", by: "sub_new" });
});

test("past_due on a replaced subscription does not start a grace clock", () => {
  const d = decideSubscriptionSync({
    currentStatus: "past_due",
    otherSubscriptions: [{ id: "sub_new", status: "trialing" }],
  });
  assert.equal(d.kind, "superseded");
});

test("dead subscriptions alongside do not count as live", () => {
  // An owner who has cancelled twice has two cancelled subscriptions and
  // should still lapse; an abandoned incomplete checkout is not paying.
  const d = decideSubscriptionSync({
    currentStatus: "canceled",
    otherSubscriptions: [
      { id: "sub_older", status: "canceled" },
      { id: "sub_abandoned", status: "incomplete_expired" },
      { id: "sub_unfinished", status: "incomplete" },
    ],
  });
  assert.deepEqual(d, { kind: "lapse" });
});

test("active applies even when another subscription is also live", () => {
  assert.deepEqual(
    decideSubscriptionSync({ currentStatus: "active", otherSubscriptions: [{ id: "sub_other", status: "active" }] }),
    { kind: "active" },
  );
});

test("statuses the app does not act on are ignored rather than guessed at", () => {
  for (const currentStatus of ["incomplete", "incomplete_expired", "trialing", "paused"]) {
    assert.deepEqual(decideSubscriptionSync({ currentStatus, otherSubscriptions: [] }), { kind: "ignore" });
  }
});
