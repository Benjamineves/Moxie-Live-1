import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import {
  calendarDate,
  calendarDaysUntil,
  decideDormancy,
  decideNoPlanWindow,
  decideReminders,
  decideTier,
  initialState,
  measureBreaker,
  paidTierFromInvoices,
  reminderKey,
  reminderThresholdFor,
} from "./decide.ts";
import { decideHealth } from "./health.ts";
import { checkCronAuthorization } from "./auth.ts";
import type { AccountRow, ActiveVesselRow, StripeAccountFacts } from "./types.ts";

const BASIC = "price_1UBJBvF2ijdqsFlLI53vIrU5";
const FULL = "price_1U8lmnF2ijdqsFlLiI4xOCjq";
process.env.STRIPE_PRICE_ID_BASIC_SUBSCRIPTION = BASIC;
process.env.STRIPE_PRICE_ID_FULL = FULL;

const NOW = new Date("2026-09-15T17:00:00Z");
const DAY = 86_400_000;

function account(over: Partial<AccountRow> = {}): AccountRow {
  return {
    id: "acct-1",
    email: "owner@example.com",
    role: "owner",
    subscription_status: "active",
    subscription_tier: "basic",
    stripe_customer_id: "cus_1",
    stripe_subscription_id: "sub_1",
    past_due_since: null,
    downgrade_grace_until: null,
    no_plan_since: null,
    expiry_reminders_opt_out_at: null,
    ...over,
  };
}

function found(over: Partial<Extract<StripeAccountFacts, { kind: "found" }>> = {}): StripeAccountFacts {
  return {
    kind: "found",
    subscriptions: [{ id: "sub_1", status: "active", created: 1 }],
    live: { id: "sub_1", status: "active" },
    multipleLive: false,
    paidTier: "basic",
    paidTierSource: "in_1",
    ...over,
  };
}

const none = new Set<string>();

// ── Tier ────────────────────────────────────────────────────────────────

test("tier: an exempt account is recorded exempt and never compared", () => {
  const r = decideTier({ account: account({ subscription_tier: "full" }), exempt: true, facts: found({ paidTier: "basic" }), previousSignatures: none, state: initialState(account(), []) });
  assert.deepEqual(r.findings.map((f) => f.kind), ["exempt"]);
  assert.equal(r.next.tier, "basic");
});

test("tier: a customer Stripe can't find is an anomaly that stops the account, never a lapse", () => {
  const a = account({ subscription_tier: "full" });
  const r = decideTier({ account: a, exempt: false, facts: { kind: "customer_missing", detail: "No such customer" }, previousSignatures: none, state: initialState(a, ["v1"]) });
  assert.equal(r.findings[0].kind, "anomaly");
  assert.equal(r.findings[0].signature, "tier:customer_missing");
  assert.ok(r.stop, "later steps must not run on unreconciled state");
  assert.equal(r.next.status, "active");
  assert.ok(!r.findings.some((f) => f.removesAccess));
});

test("tier: a plan with no Stripe customer, not exempt, is an anomaly", () => {
  const a = account({ stripe_customer_id: null });
  const r = decideTier({ account: a, exempt: false, facts: null, previousSignatures: none, state: initialState(a, []) });
  assert.equal(r.findings[0].signature, "tier:plan_without_customer");
  assert.ok(r.stop);
});

test("tier: paying for more applies at once; paying for less waits for a second sighting a day later", () => {
  const up = account({ subscription_tier: "basic" });
  const upR = decideTier({ account: up, exempt: false, facts: found({ paidTier: "full" }), previousSignatures: none, state: initialState(up, []) });
  assert.equal(upR.findings[0].signature, "tier:basic->full");
  assert.equal(upR.next.tier, "full");

  const down = account({ subscription_tier: "full" });
  const first = decideTier({ account: down, exempt: false, facts: found({ paidTier: "basic" }), previousSignatures: none, state: initialState(down, []) });
  assert.equal(first.findings[0].signature, "tier:full->basic");
  assert.equal(first.findings[0].removesAccess, true);
  assert.equal(first.next.tier, "full", "not applied on first sighting");

  const second = decideTier({ account: down, exempt: false, facts: found({ paidTier: "basic" }), previousSignatures: new Set(["tier:full->basic"]), state: initialState(down, []) });
  assert.equal(second.next.tier, "basic");
});

test("tier: 90806ee6's shape reports a downgrade and carries its review note", () => {
  const a = account({ id: "90806ee6-7f4d-4f17-aa7a-894e9fdb07d1", subscription_tier: "full", stripe_subscription_id: "sub_1UBJeTF2ijdqsFlLZ7sdkun1" });
  const r = decideTier({ account: a, exempt: false, facts: found({ live: { id: "sub_1UBJeTF2ijdqsFlLZ7sdkun1", status: "active" }, paidTier: "basic" }), previousSignatures: none, state: initialState(a, []) });
  assert.equal(r.findings[0].signature, "tier:full->basic");
  assert.match(String(r.findings[0].detail.review_note), /own test account/);
});

test("tier: no live plan in Stripe lapses only on a second sighting", () => {
  const a = account();
  const facts = found({ live: null, subscriptions: [{ id: "sub_1", status: "canceled", created: 1 }], paidTier: null });
  const first = decideTier({ account: a, exempt: false, facts, previousSignatures: none, state: initialState(a, ["v1"]) });
  assert.equal(first.findings[0].signature, "status:active->canceled");
  assert.equal(first.next.status, "active");
  const second = decideTier({ account: a, exempt: false, facts, previousSignatures: new Set(["status:active->canceled"]), state: initialState(a, ["v1"]) });
  assert.equal(second.next.status, "canceled");
  assert.equal(second.next.tier, "basic");
});

test("tier: an undetermined paid tier is reported and the stored tier stands", () => {
  const a = account({ subscription_tier: "full" });
  const r = decideTier({ account: a, exempt: false, facts: found({ paidTier: null }), previousSignatures: none, state: initialState(a, []) });
  assert.equal(r.findings[0].signature, "tier:undetermined");
  assert.equal(r.next.tier, "full");
  assert.ok(!r.stop);
});

test("paid tier: a paid tier_upgrade after the latest plan invoice means Full (else every upgrader is downgraded)", () => {
  const subscription = { id: "sub_1", latest_invoice: "in_signup" } as unknown as Stripe.Subscription;
  const signup = {
    id: "in_signup",
    status: "paid",
    created: 100,
    lines: { data: [{ amount: 5900, pricing: { price_details: { price: BASIC } }, parent: { subscription_item_details: { proration: false } } }], has_more: false },
  } as unknown as Stripe.Invoice;
  const upgrade = { id: "in_up", status: "paid", created: 200, metadata: { payment_type: "tier_upgrade", subscription_id: "sub_1" } } as unknown as Stripe.Invoice;
  assert.deepEqual(paidTierFromInvoices({ subscription, latestInvoice: signup, upgradeInvoices: [] }), { tier: "basic", source: "in_signup" });
  assert.deepEqual(paidTierFromInvoices({ subscription, latestInvoice: signup, upgradeInvoices: [upgrade] }), { tier: "full", source: "in_up" });
  const otherSub = { ...upgrade, metadata: { payment_type: "tier_upgrade", subscription_id: "sub_other" } } as unknown as Stripe.Invoice;
  assert.equal(paidTierFromInvoices({ subscription, latestInvoice: signup, upgradeInvoices: [otherSub] }).tier, "basic");
});

// ── No-plan window ──────────────────────────────────────────────────────

test("no-plan: b6cac9fa's shape starts a 30-day clock; it lapses only after 30 days; a plan clears it", () => {
  const a = account({ id: "b6cac9fa", subscription_status: "none", stripe_customer_id: null });
  const start = decideNoPlanWindow({ account: a, exempt: false, state: initialState(a, ["v1"]), now: NOW });
  assert.equal(start.findings[0].signature, "no_plan:start");
  assert.equal(start.findings[0].detail.deadline, new Date(NOW.getTime() + 30 * DAY).toISOString());

  const running = account({ ...a, no_plan_since: new Date(NOW.getTime() - 29 * DAY).toISOString() });
  assert.equal(decideNoPlanWindow({ account: running, exempt: false, state: initialState(running, ["v1"]), now: NOW }).findings.length, 0);

  const expired = account({ ...a, no_plan_since: new Date(NOW.getTime() - 30 * DAY).toISOString() });
  const lapse = decideNoPlanWindow({ account: expired, exempt: false, state: initialState(expired, ["v1", "v2"]), now: NOW });
  assert.equal(lapse.findings[0].signature, "no_plan:lapse");
  assert.equal(lapse.findings[0].pausesVessels, 2);
  assert.deepEqual(lapse.next.activeVesselIds, []);

  const subscribed = account({ ...expired, subscription_status: "active" });
  assert.equal(decideNoPlanWindow({ account: subscribed, exempt: false, state: initialState(subscribed, ["v1"]), now: NOW }).findings[0].signature, "no_plan:clear");
});

test("no-plan: the admin account holding vessels by hand is exempt", () => {
  const a = account({ subscription_status: "none" });
  assert.equal(decideNoPlanWindow({ account: a, exempt: true, state: initialState(a, ["v1"]), now: NOW }).findings[0].kind, "exempt");
});

// ── Dormancy ────────────────────────────────────────────────────────────

test("dormancy: past-due grace ends after 7 days and lapses every active vessel", () => {
  const a = account({ subscription_status: "past_due", past_due_since: new Date(NOW.getTime() - 7 * DAY).toISOString() });
  const r = decideDormancy({ account: a, capExempt: false, state: initialState(a, ["v1", "v2"]), now: NOW });
  assert.equal(r.findings[0].signature, "dormancy:lapse");
  assert.equal(r.findings[0].pausesVessels, 2);
  const early = account({ ...a, past_due_since: new Date(NOW.getTime() - 6 * DAY).toISOString() });
  assert.equal(decideDormancy({ account: early, capExempt: false, state: initialState(early, ["v1"]), now: NOW }).findings.length, 0);
});

test("dormancy: an expired downgrade clock locks the vessels beyond the limit, least recently updated first", () => {
  const a = account({ downgrade_grace_until: new Date(NOW.getTime() - DAY).toISOString() });
  const r = decideDormancy({ account: a, capExempt: false, state: initialState(a, ["newest", "mid", "old"]), now: NOW });
  assert.equal(r.findings[0].signature, "dormancy:lock");
  assert.deepEqual(r.findings[0].detail.lock_vessel_ids, ["old"]);
  assert.deepEqual(r.next.activeVesselIds, ["newest", "mid"]);
  assert.equal(decideDormancy({ account: a, capExempt: true, state: initialState(a, ["a", "b", "c"]), now: NOW }).findings[0].kind, "exempt");
});

test("dormancy runs on the state the earlier steps left: a lapsed no-plan account has nothing to lock", () => {
  const a = account({ downgrade_grace_until: new Date(NOW.getTime() - DAY).toISOString() });
  const r = decideDormancy({ account: a, capExempt: false, state: { status: "none", tier: "basic", activeVesselIds: [] }, now: NOW });
  assert.equal(r.findings[0].signature, "dormancy:clear_clock");
  assert.ok(!r.findings.some((f) => f.removesAccess));
});

// ── Reminders ───────────────────────────────────────────────────────────

test("reminders: windows are (7,30] -> 30, (0,7] -> 7, 0 -> 0, and nothing after expiry", () => {
  assert.equal(reminderThresholdFor(31), null);
  assert.equal(reminderThresholdFor(30), 30);
  assert.equal(reminderThresholdFor(12), 30);
  assert.equal(reminderThresholdFor(8), 30);
  assert.equal(reminderThresholdFor(7), 7);
  assert.equal(reminderThresholdFor(6), 7, "a missed run from 31 to 6 gets the 7-day reminder only");
  assert.equal(reminderThresholdFor(1), 7);
  assert.equal(reminderThresholdFor(0), 0);
  assert.equal(reminderThresholdFor(-1), null);
});

test("reminders: days are counted in Los Angeles, not UTC", () => {
  // 05:00 UTC on the 16th is still the 15th in Los Angeles.
  const lateEvening = new Date("2026-09-16T05:00:00Z");
  assert.equal(calendarDate(lateEvening), "2026-09-15");
  assert.equal(calendarDaysUntil("2026-09-16", lateEvening), 1);
  assert.equal(calendarDaysUntil("2026-09-15", lateEvening), 0);
});

const vessel = (over: Partial<ActiveVesselRow> = {}): ActiveVesselRow => ({
  id: "v1",
  owner_id: "acct-1",
  mxe_id: "MXE-01010",
  vessel_name: "Test",
  updated_at: "2026-09-01T00:00:00Z",
  reg_expiry: null,
  ins_expiry: null,
  fishing_license_expiry: null,
  fishing_license_lifetime: null,
  ...over,
});

test("reminders: Full owners only, not opted out, one per crossed window, suppressed once claimed", () => {
  const in7 = "2026-09-22";
  const v = vessel({ ins_expiry: in7, reg_expiry: "2027-01-01", fishing_license_expiry: in7, fishing_license_lifetime: true });
  const full = account({ subscription_tier: "full" });
  const r = decideReminders({ account: full, state: initialState(full, ["v1"]), vessels: [v], sentKeys: none, now: NOW });
  assert.deepEqual(r.findings.map((f) => f.signature), [`reminder:insurance:${in7}:7`], "lifetime fishing licence and far registration send nothing");
  assert.equal(r.eligibleDocuments, 2);

  const basic = account({ subscription_tier: "basic" });
  assert.equal(decideReminders({ account: basic, state: initialState(basic, ["v1"]), vessels: [v], sentKeys: none, now: NOW }).findings.length, 0);

  const optedOut = account({ subscription_tier: "full", expiry_reminders_opt_out_at: "2026-09-01T00:00:00Z" });
  assert.equal(decideReminders({ account: optedOut, state: initialState(optedOut, ["v1"]), vessels: [v], sentKeys: none, now: NOW }).findings.length, 0);

  const sent = new Set([reminderKey({ vesselId: "v1", ownerId: "acct-1", docType: "insurance", expiryDate: in7, threshold: 7 })]);
  assert.equal(decideReminders({ account: full, state: initialState(full, ["v1"]), vessels: [v], sentKeys: sent, now: NOW }).findings.length, 0);

  // A vessel paused earlier in this run gets nothing.
  assert.equal(decideReminders({ account: full, state: initialState(full, []), vessels: [v], sentKeys: none, now: NOW }).findings.length, 0);
});

// ── Breaker, health, auth ───────────────────────────────────────────────

test("breaker: trips on a proportion, with a floor so one routine event can't trip it at small scale", () => {
  const rule = { proportion: 0.05, floor: 2 };
  assert.equal(measureBreaker(2, 7, rule).trips, false, "two of seven: at the floor");
  assert.equal(measureBreaker(3, 7, rule).trips, true);
  assert.equal(measureBreaker(10, 1000, rule).trips, false, "ten of a thousand is routine");
  assert.equal(measureBreaker(51, 1000, rule).trips, true);
});

test("health: ok only for a succeeded or partial run finished within 26 hours", () => {
  const at = (h: number) => new Date(NOW.getTime() - h * 3_600_000).toISOString();
  assert.equal(decideHealth(null, NOW).healthy, false);
  assert.equal(decideHealth({ status: "succeeded", finished_at: at(25) }, NOW).healthy, true);
  assert.equal(decideHealth({ status: "partial", finished_at: at(1) }, NOW).healthy, true);
  assert.equal(decideHealth({ status: "succeeded", finished_at: at(27) }, NOW).healthy, false);
  assert.equal(decideHealth({ status: "failed", finished_at: at(1) }, NOW).healthy, false);
  assert.equal(decideHealth({ status: "timed_out", finished_at: at(1) }, NOW).healthy, false);
});

test("auth: refuses without a configured secret, and accepts only the exact bearer header", () => {
  assert.equal(checkCronAuthorization("Bearer x", undefined), "unconfigured");
  assert.equal(checkCronAuthorization("Bearer x", "   "), "unconfigured");
  assert.equal(checkCronAuthorization(null, "s3cret"), "unauthorized");
  assert.equal(checkCronAuthorization("s3cret", "s3cret"), "unauthorized");
  assert.equal(checkCronAuthorization("Bearer s3cre", "s3cret"), "unauthorized");
  assert.equal(checkCronAuthorization("Bearer s3cret ", "s3cret"), "unauthorized");
  assert.equal(checkCronAuthorization("Bearer s3cret", "s3cret"), "ok");
});
