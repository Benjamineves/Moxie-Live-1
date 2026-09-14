import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateVesselCap } from "./vessel-cap.ts";
import { VESSEL_LIMIT } from "./tier-config.ts";

test("allows a vessel while the account is under its plan's limit", () => {
  const d = evaluateVesselCap({ activeCount: VESSEL_LIMIT.basic - 1, tier: "basic", capExempt: false });
  assert.equal(d.allowed, true);
});

test("refuses the vessel that would exceed the limit — at the limit, not past it", () => {
  // The bypass this closes: an owner at the limit must be refused, because
  // allowing "one more" at the limit is exactly how six active vessels end
  // up on a plan for two.
  const d = evaluateVesselCap({ activeCount: VESSEL_LIMIT.basic, tier: "basic", capExempt: false });
  assert.equal(d.allowed, false);
  if (!d.allowed) {
    assert.match(d.message, /Nothing has been charged/);
    assert.equal(d.limit, VESSEL_LIMIT.basic);
  }
});

test("the limit follows the tier", () => {
  assert.equal(evaluateVesselCap({ activeCount: VESSEL_LIMIT.basic, tier: "full", capExempt: false }).allowed, true);
  assert.equal(evaluateVesselCap({ activeCount: VESSEL_LIMIT.full, tier: "full", capExempt: false }).allowed, false);
});

test("an account already over the limit is still refused", () => {
  // Reachable today: the bypass being closed left real accounts over their
  // cap, and a transfer buyer can be too. Over is not a special case.
  assert.equal(evaluateVesselCap({ activeCount: VESSEL_LIMIT.basic + 4, tier: "basic", capExempt: false }).allowed, false);
});

test("admin accounts are exempt, matching is_admin_email() in SQL", () => {
  assert.equal(evaluateVesselCap({ activeCount: 99, tier: "basic", capExempt: true }).allowed, true);
});

test("a nonsense count cannot open the cap", () => {
  // NaN compares false against everything, so `NaN < limit` is false and
  // must fall through to a refusal, not an allowance.
  assert.equal(evaluateVesselCap({ activeCount: Number.NaN, tier: "basic", capExempt: false }).allowed, false);
  assert.equal(evaluateVesselCap({ activeCount: -3, tier: "basic", capExempt: false }).allowed, true);
});
