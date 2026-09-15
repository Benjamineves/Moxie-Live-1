import { test } from "node:test";
import assert from "node:assert/strict";
import { brief, describeFinding } from "./describe.ts";
import { digestSubject, renderDigestHtml, renderDigestText } from "./digest.ts";
import { STEP_MODES } from "./config.ts";
import type { Finding } from "./types.ts";

type Row = Finding & { owner_id: string | null };
const row = (f: Partial<Row> & Pick<Row, "step" | "kind" | "signature">): Row => ({ detail: {}, owner_id: "90806ee6-7f4d-4f17-aa7a-894e9fdb07d1", ...f });

const KNOWN = { review_note: "Known test account (test data left by the upgrade bug fixed on 2 September)", review_until: "until the tier step is switched on, when it has to be resolved first" };

test("a known account's downgrade reads as a sentence, by email, and needs nobody", () => {
  const d = describeFinding(
    row({ step: "tier", kind: "would_change", signature: "tier:full->basic", detail: { from: "full", to: "basic", applies: "next run, if still present (two-run rule)", owner_email: "benjamineves@gmail.com", ...KNOWN } }),
  )!;
  assert.equal(d.needsYou, false);
  assert.equal(
    d.text,
    "Would downgrade benjamineves@gmail.com from Full to Basic: they've paid for Basic only. It would only apply if a run tomorrow still finds this. Known test account (test data left by the upgrade bug fixed on 2 September) — no action needed until the tier step is switched on, when it has to be resolved first.",
  );
  assert.doesNotMatch(d.text, /[0-9a-f]{8}-[0-9a-f]{4}/, "no UUIDs");
});

test("the same downgrade on an account nobody has explained needs you", () => {
  const d = describeFinding(row({ step: "tier", kind: "would_change", signature: "tier:full->basic", detail: { from: "full", to: "basic", owner_email: "someone@example.com" } }))!;
  assert.equal(d.needsYou, true);
});

test("vessel findings name the vessels by MXE ID", () => {
  const start = describeFinding(
    row({ step: "no_plan_window", kind: "would_change", signature: "no_plan:start", detail: { active_vessels: 1, mxe_ids: ["MXE-01024"], deadline: "2026-10-15T19:15:11.649Z", owner_email: "buyer@example.com" } }),
  )!;
  assert.equal(start.needsYou, false);
  assert.equal(start.text, "Would start buyer@example.com's 30-day window to choose a plan: they hold 1 active vessel (MXE-01024) with no plan. If they don't subscribe, it pauses on October 15, 2026.");

  const lock = describeFinding(
    row({ step: "dormancy", kind: "would_change", signature: "dormancy:lock", detail: { lock_vessel_ids: ["a", "b"], mxe_ids: ["MXE-01016", "MXE-01017"], tier: "basic", limit: 2, grace_until: "2026-09-14T00:00:00Z", owner_email: "o@example.com" } }),
  )!;
  assert.equal(lock.text, "Would pause 2 of o@example.com's vessels (MXE-01016, MXE-01017): their 14-day window to get within the Basic limit of 2 ended on September 14, 2026.");

  const reminder = describeFinding(
    row({ step: "reminders", kind: "would_change", signature: "reminder:insurance:2026-09-22:7", detail: { mxe_id: "MXE-01010", doc: "insurance", expiry_date: "2026-09-22", days_remaining: 7, owner_email: "o@example.com" } }),
  )!;
  assert.equal(reminder.text, "Would email o@example.com that MXE-01010's insurance expires in 7 days (September 22, 2026).");
});

test("failures and anomalies need you, even on a known account; skips are folded into the failure", () => {
  const failed = describeFinding(row({ step: "tier", kind: "failed", signature: "tier:failed", detail: { error: "Stripe 500", owner_email: "o@example.com", ...KNOWN } }))!;
  assert.equal(failed.needsYou, true);
  assert.match(failed.text, /^Couldn't run the plan check for o@example.com: Stripe 500\./);
  assert.equal(describeFinding(row({ step: "dormancy", kind: "skipped", signature: "dormancy:skipped", detail: {} })), null);
  const undetermined = describeFinding(row({ step: "tier", kind: "anomaly", signature: "tier:undetermined", detail: { stored_tier: "full", owner_email: "o@example.com", ...KNOWN } }))!;
  assert.equal(undetermined.needsYou, true);
  assert.match(undetermined.text, /STRIPE_PRICE_ID_BASIC_SUBSCRIPTION/);
  const missing = describeFinding(row({ step: "tier", kind: "anomaly", signature: "tier:customer_missing", detail: { customer: "cus_x", owner_email: "o@example.com" } }))!;
  assert.equal(missing.needsYou, true);
});

test("without an email on the event, the sentence still avoids a bare UUID", () => {
  const d = describeFinding(row({ step: "tier", kind: "exempt", signature: "tier:exempt", detail: {} }))!;
  assert.equal(d.text, "Skipped account 90806ee6…: their plan is set by hand, so it isn't checked against Stripe.");
});

test("the digest leads with whether anything needs you, then the sentences, then the run details", () => {
  const findings: Row[] = [
    row({ step: "tier", kind: "would_change", signature: "tier:full->basic", detail: { from: "full", to: "basic", owner_email: "benjamineves@gmail.com", ...KNOWN } }),
    row({ step: "tier", kind: "exempt", signature: "tier:exempt", owner_id: "admin", detail: { owner_email: "admin@moxieyachting.com" } }),
  ];
  const input = { runId: "r1", status: "succeeded", trigger: "cron", modes: STEP_MODES, startedAt: "2026-09-16T17:00:04.000Z", finishedAt: null, summary: { accounts_visited: 5 }, findings };
  assert.equal(digestSubject(input), "Moxie scheduler: nothing needs you, 2 for information (report-only)");
  const txt = renderDigestText(input);
  const lines = txt.split("\n");
  assert.equal(lines[2], "NOTHING NEEDS YOU.", "the first thing after the wordmark");
  assert.ok(txt.indexOf("NO ACTION NEEDED") < txt.indexOf("Accounts checked"), "sentences before run details");
  const html = renderDigestHtml(input);
  assert.ok(html.indexOf("Nothing needs you.") < html.indexOf("No action needed"));

  const withProblem = { ...input, findings: [...findings, row({ step: "tier", kind: "failed", signature: "tier:failed", owner_id: "x", detail: { error: "boom", owner_email: "x@example.com" } })] };
  const b = brief({ findings: withProblem.findings, status: "partial" });
  assert.equal(b.headline, "1 thing needs you.");
  assert.ok(renderDigestText(withProblem).indexOf("NEEDS YOU") < renderDigestText(withProblem).indexOf("NO ACTION NEEDED"));
});

test("skips by design come after the findings that matter", () => {
  const b = brief({
    status: "succeeded",
    findings: [
      row({ step: "tier", kind: "exempt", signature: "tier:exempt", owner_id: "admin", detail: { owner_email: "admin@moxieyachting.com" } }),
      row({ step: "no_plan_window", kind: "would_change", signature: "no_plan:start", owner_id: "b", detail: { active_vessels: 2, mxe_ids: ["MXE-1", "MXE-2"], deadline: "2026-10-15T00:00:00Z", owner_email: "b@example.com" } }),
    ],
  });
  assert.match(b.noAction[0], /^Would start b@example.com's 30-day window.*they pause on/);
  assert.match(b.noAction[1], /^Skipped admin@moxieyachting.com/);
});

test("the same configuration cause on several accounts is one line, not one per account", () => {
  const b = brief({
    status: "succeeded",
    findings: ["a@example.com", "b@example.com", "c@example.com"].map((email, i) =>
      row({ step: "tier", kind: "anomaly", signature: "tier:undetermined", owner_id: `o${i}`, detail: { stored_tier: "basic", owner_email: email } }),
    ),
  });
  assert.equal(b.headline, "1 thing needs you.");
  assert.match(b.needsYou[0], /^Couldn't tell which plan 3 accounts have paid for \(a@example.com, b@example.com, c@example.com\)/);
});
