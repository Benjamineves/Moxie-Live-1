import { test } from "node:test";
import assert from "node:assert/strict";
import {
  decideGraceNotification,
  graceStartedMessage,
  tierFromSubscriptions,
  vesselsLockedMessage,
  type SubscriptionSummary,
} from "./dormancy-notifications.ts";
import { VESSEL_LIMIT } from "./tier-config.ts";

const tierOf = (priceId: string | null) => (priceId === "price_full" ? "full" : priceId === "price_basic" ? "basic" : null);
const sub = (over: Partial<SubscriptionSummary>): SubscriptionSummary => ({ id: "sub", status: "active", created: 1, priceId: "price_basic", ...over });

const CLOCK = "2026-10-15T12:00:00.123456+00:00";

test("THE BUNDLE RACE: a clock started against a stale tier is not notified", () => {
  // The account holds Basic's limit plus one and has just paid for Full.
  // The stored tier still says Basic, so reconcile started a clock. Stripe
  // already has the Full subscription — measured against that, there is no
  // overflow, and nothing is sent. The tier event clears the clock.
  const confirmedTier = tierFromSubscriptions([sub({ status: "active", priceId: "price_full" })], tierOf);
  assert.equal(confirmedTier, "full");
  const d = decideGraceNotification({
    graceUntil: CLOCK,
    notifiedFor: null,
    activeCount: VESSEL_LIMIT.basic + 1,
    tier: confirmedTier ?? "basic",
  });
  assert.deepEqual(d, { notify: false, reason: "not_over_confirmed_tier", limit: VESSEL_LIMIT.full });
});

test("the race also holds while Stripe still shows the new plan as incomplete", () => {
  // At the racing moment the subscription may not have been moved to
  // active yet. The newest incomplete subscription is the plan being bought.
  assert.equal(
    tierFromSubscriptions([sub({ id: "old", status: "canceled", created: 1, priceId: "price_basic" }), sub({ id: "new", status: "incomplete", created: 2, priceId: "price_full" })], tierOf),
    "full",
  );
});

test("a genuine overflow on the confirmed tier is notified", () => {
  const d = decideGraceNotification({ graceUntil: CLOCK, notifiedFor: null, activeCount: VESSEL_LIMIT.basic + 1, tier: "basic" });
  assert.deepEqual(d, { notify: true, limit: VESSEL_LIMIT.basic });
});

test("one clock is notified once, and a new clock is notified again", () => {
  assert.equal(
    decideGraceNotification({ graceUntil: CLOCK, notifiedFor: "2026-10-15T12:00:00.123456Z", activeCount: 9, tier: "basic" }).notify,
    false,
    "the same instant in a different spelling is the same clock",
  );
  assert.equal(
    decideGraceNotification({ graceUntil: "2026-11-02T08:00:00+00:00", notifiedFor: CLOCK, activeCount: 9, tier: "basic" }).notify,
    true,
    "a clock that restarted has a new deadline, so it is a new episode",
  );
});

test("no clock, no notification", () => {
  assert.deepEqual(decideGraceNotification({ graceUntil: null, notifiedFor: null, activeCount: 9, tier: "basic" }), { notify: false, reason: "no_clock" });
});

test("a live subscription outranks a newer incomplete one", () => {
  // An existing subscriber's abandoned checkout must not change what tier
  // they are measured against.
  assert.equal(
    tierFromSubscriptions([sub({ status: "active", created: 1, priceId: "price_basic" }), sub({ status: "incomplete", created: 9, priceId: "price_full" })], tierOf),
    "basic",
  );
});

test("Stripe with nothing current returns null, so the stored tier is used", () => {
  assert.equal(tierFromSubscriptions([], tierOf), null);
  assert.equal(tierFromSubscriptions([sub({ status: "canceled" }), sub({ status: "incomplete_expired" })], tierOf), null);
  assert.equal(tierFromSubscriptions([sub({ status: "active", priceId: "price_unknown" })], tierOf), null);
});

test("the grace message quotes the stored deadline, not a day count", () => {
  const m = graceStartedMessage({ activeCount: 3, tier: "basic", graceUntil: CLOCK });
  assert.match(m, /October 15, 2026/);
  assert.match(m, /3 active vessels/);
  assert.doesNotMatch(m, /14 days/);
});

test("the lock message names the count once, for the whole account", () => {
  assert.match(vesselsLockedMessage(4), /^4 vessels on your account have been paused/);
  assert.match(vesselsLockedMessage(1), /^1 vessel on your account has been paused/);
});
