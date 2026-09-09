/**
 * The two rules §3.2 asks for, both of which are off-by-one shaped.
 *
 * The thresholds decide when Ben is told to start a print run that takes
 * days, so "at 25" versus "below 25" is a real difference. And the
 * stock-since cutoff decides whether ten historical vessels wear a
 * permanent amber flag — an alert that is always on is an alert nobody
 * reads, which would quietly disarm the one warning that says a badge
 * has to be printed by hand.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  POOL_AMBER_THRESHOLD,
  POOL_RED_THRESHOLD,
  needsIndividualPrinting,
  poolLevel,
} from "./badge-pool.ts";

test("the thresholds are the ones the spec names", () => {
  assert.equal(POOL_AMBER_THRESHOLD, 25);
  assert.equal(POOL_RED_THRESHOLD, 10);
});

test("pool levels are inclusive at each boundary", () => {
  assert.equal(poolLevel(100), "ok");
  assert.equal(poolLevel(26), "ok");
  assert.equal(poolLevel(25), "amber", "at the amber threshold it is already amber, not still ok");
  assert.equal(poolLevel(11), "amber");
  assert.equal(poolLevel(10), "red", "at the red threshold it is already red, not still amber");
  assert.equal(poolLevel(1), "red");
  assert.equal(poolLevel(0), "empty");
});

test("an impossible negative count still reads as empty, not ok", () => {
  // Nothing should produce this, but a count that went wrong must not
  // present as a healthy pool.
  assert.equal(poolLevel(-1), "empty");
});

const STOCK_SINCE = "2026-09-09T07:36:10.254Z";

test("a vessel with an assigned badge never needs individual printing", () => {
  assert.equal(
    needsIndividualPrinting(
      { badge_identity_id: "some-uuid", created_at: "2026-09-09T09:00:00Z" },
      STOCK_SINCE,
    ),
    false,
  );
});

test("a vessel that registered after stock existed, with no badge, does", () => {
  // This is the §3.2 fallback: stock was there to draw from and was
  // empty. Nothing is on the shelf for this order.
  assert.equal(
    needsIndividualPrinting({ badge_identity_id: null, created_at: "2026-09-09T09:00:00Z" }, STOCK_SINCE),
    true,
  );
});

test("a vessel that predates any stock does NOT", () => {
  // Ten of these exist. They were printed one at a time because that was
  // the only way at the time, and most have already shipped. Flagging
  // them would mean the queue is permanently amber.
  assert.equal(
    needsIndividualPrinting({ badge_identity_id: null, created_at: "2026-09-01T20:58:02Z" }, STOCK_SINCE),
    false,
  );
});

test("a vessel created at the exact moment stock appeared counts as after", () => {
  // The boundary has to fall somewhere and it falls here: at that
  // instant the pool existed, so a null badge means the claim genuinely
  // failed rather than that there was nothing to claim.
  assert.equal(
    needsIndividualPrinting({ badge_identity_id: null, created_at: STOCK_SINCE }, STOCK_SINCE),
    true,
  );
});

test("nothing is flagged before stock has ever existed", () => {
  // stockSince is null on a system that has never minted and stocked a
  // batch. Every vessel has a null badge_identity_id then, and none of
  // them is a fallback.
  assert.equal(
    needsIndividualPrinting({ badge_identity_id: null, created_at: "2026-09-09T09:00:00Z" }, null),
    false,
  );
});

test("a vessel with no creation timestamp is not flagged", () => {
  // Unknowable rather than false — and silence beats crying wolf on a
  // row whose age cannot be established.
  assert.equal(needsIndividualPrinting({ badge_identity_id: null, created_at: null }, STOCK_SINCE), false);
});
