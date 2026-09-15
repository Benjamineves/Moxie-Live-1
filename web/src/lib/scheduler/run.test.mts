import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { runScheduler, type RunDeps } from "./run.ts";
import { STEP_MODES } from "./config.ts";
import type { SchedulerBookkeeping, SchedulerReads } from "./store.ts";
import type { StripeReads } from "./stripe-reads.ts";
import type { AccountRow, ActiveVesselRow, Finding } from "./types.ts";

process.env.STRIPE_PRICE_ID_BASIC_SUBSCRIPTION = "price_basic";
process.env.STRIPE_PRICE_ID_FULL = "price_full";

const NOW = new Date("2026-09-15T17:00:00Z");

function acct(id: string, over: Partial<AccountRow> = {}): AccountRow {
  return {
    id,
    email: `${id}@example.com`,
    role: "owner",
    subscription_status: "active",
    subscription_tier: "basic",
    stripe_customer_id: `cus_${id}`,
    stripe_subscription_id: `sub_${id}`,
    past_due_since: null,
    downgrade_grace_until: null,
    no_plan_since: null,
    expiry_reminders_opt_out_at: null,
    ...over,
  };
}

function vessel(id: string, owner: string): ActiveVesselRow {
  return { id, owner_id: owner, mxe_id: `MXE-${id}`, vessel_name: id, updated_at: "2026-09-01T00:00:00Z", reg_expiry: null, ins_expiry: null, fishing_license_expiry: null, fishing_license_lifetime: null };
}

type Harness = {
  deps: RunDeps;
  calls: string[];
  events: (Finding & { owner: string | null })[];
  finished: { status: string; summary: Record<string, unknown>; needsAlert: boolean }[];
  sent: { to: string; subject: string }[];
};

function harness(opts: {
  accounts: AccountRow[];
  vessels?: ActiveVesselRow[];
  stripe?: StripeReads["accountFacts"];
  lease?: { runId: string } | { overlap: true };
  now?: () => Date;
  budgetMs?: number;
  sendOk?: boolean;
}): Harness {
  const calls: string[] = [];
  const events: Harness["events"] = [];
  const finished: Harness["finished"] = [];
  const sent: Harness["sent"] = [];
  let alertClaimed = false;

  const reads: SchedulerReads = {
    loadAccounts: async () => (calls.push("read:accounts"), opts.accounts),
    loadActiveVessels: async () => (calls.push("read:vessels"), opts.vessels ?? []),
    loadCheckedAt: async () => new Map(),
    loadReminderKeys: async () => new Set(),
    loadPreviousTierSignatures: async () => new Map(),
    loadAdminRecipients: async () => [{ id: "admin", email: "admin@moxieyachting.com" }],
  };
  const books: SchedulerBookkeeping = {
    acquireLease: async () => (calls.push("books:lease"), opts.lease ?? { runId: "run-1" }),
    recordFindings: async (_r, owner, findings) => {
      calls.push("books:events");
      for (const f of findings) events.push({ ...f, owner });
    },
    markChecked: async () => void calls.push("books:checked"),
    finishRun: async (_r, res) => {
      calls.push("books:finish");
      finished.push({ status: res.status, summary: res.summary, needsAlert: res.needsAlert });
    },
    claimAlert: async () => {
      if (alertClaimed) return false;
      alertClaimed = true;
      return true;
    },
    releaseAlert: async () => {
      calls.push("books:release");
      alertClaimed = false;
    },
    pendingAlerts: async () => [],
    loadRunFindings: async () => [],
  };
  const stripe: StripeReads = {
    accountFacts:
      opts.stripe ??
      (async (customer) => ({
        kind: "found",
        subscriptions: [{ id: customer.replace("cus_", "sub_"), status: "active", created: 1 }],
        live: { id: customer.replace("cus_", "sub_"), status: "active" },
        multipleLive: false,
        paidTier: "basic",
        paidTierSource: "in_x",
      })),
  };
  return {
    calls,
    events,
    finished,
    sent,
    deps: {
      trigger: "cron",
      reads,
      books,
      stripe,
      isCapExempt: () => false,
      now: opts.now ?? (() => NOW),
      budgetMs: opts.budgetMs,
      log: () => {},
      sendDigest: async (m) => {
        sent.push({ to: m.to, subject: m.subject });
        return opts.sendOk === false ? { sent: false, detail: "resend down" } : { sent: true };
      },
    },
  };
}

test("phase 1 refuses to start if any step is set to act — there is no acting path to run", async () => {
  const h = harness({ accounts: [acct("a")] });
  await assert.rejects(
    runScheduler({ ...h.deps, modes: { ...STEP_MODES, dormancy: "act" } }),
    /report-only; no acting path exists for: dormancy/,
  );
  assert.deepEqual(h.calls, [], "refused before taking the lease or reading anything");
  assert.ok(Object.values(STEP_MODES).every((m) => m === "report"), "shipped config is report-only");
});

test("a clean run with nothing to report records nothing and sends no digest", async () => {
  const h = harness({ accounts: [acct("a")], vessels: [vessel("v1", "a")] });
  const r = await runScheduler(h.deps);
  assert.equal(r.outcome, "finished");
  assert.equal(h.finished[0].status, "succeeded");
  assert.equal(h.finished[0].needsAlert, false);
  assert.equal(h.events.length, 0);
  assert.equal(h.sent.length, 0);
});

test("one account's Stripe failure skips its later steps only; the run continues, ends partial, and alerts", async () => {
  const h = harness({
    accounts: [acct("bad"), acct("good", { subscription_status: "none", stripe_customer_id: null })],
    vessels: [vessel("v1", "bad"), vessel("v2", "good")],
    stripe: async (customer) => {
      if (customer === "cus_bad") throw new Error("Stripe 500");
      throw new Error("unexpected");
    },
  });
  const r = await runScheduler(h.deps);
  assert.equal(r.outcome === "finished" && r.status, "partial");
  const bad = h.events.filter((e) => e.owner === "bad").map((e) => `${e.step}:${e.kind}`);
  assert.deepEqual(bad, ["tier:failed", "no_plan_window:skipped", "dormancy:skipped", "reminders:skipped"]);
  const good = h.events.filter((e) => e.owner === "good").map((e) => e.signature);
  assert.deepEqual(good, ["no_plan:start"], "the next account still ran every step");
  assert.equal(h.finished[0].needsAlert, true);
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].subject, /^Moxie scheduler: 1 thing needs you/);
});

test("the time budget stops starting new accounts; the rest are recorded not reached", async () => {
  let t = NOW.getTime();
  const h = harness({
    accounts: [acct("a"), acct("b"), acct("c")],
    now: () => new Date((t += 400)),
    budgetMs: 1000,
  });
  const r = await runScheduler(h.deps);
  assert.equal(r.outcome === "finished" && r.status, "partial");
  const budget = h.events.find((e) => e.signature === "run:budget");
  assert.ok(budget, "not-reached accounts are an event, not silence");
  assert.ok((budget!.detail.accounts as string[]).length >= 1);
});

test("an overlapping run does nothing past the lease", async () => {
  const h = harness({ accounts: [acct("a")], lease: { overlap: true } });
  const r = await runScheduler(h.deps);
  assert.equal(r.outcome, "overlap");
  assert.deepEqual(h.calls, ["books:lease"]);
});

test("a digest that can't send gives back its claim so the next run retries it", async () => {
  const h = harness({ accounts: [acct("x", { subscription_status: "none", stripe_customer_id: null })], vessels: [vessel("v", "x")], sendOk: false });
  const r = await runScheduler(h.deps);
  assert.equal(r.outcome === "finished" && r.digest, "failed");
  assert.ok(h.calls.includes("books:release"));
});

// ── Structural: report-only can't write account state ───────────────────

const here = (f: string) => readFileSync(fileURLToPath(new URL(f, import.meta.url)), "utf8");

test("the store writes only the scheduler's own tables, and its reads never write", () => {
  const store = here("./store.ts");
  const readsBody = store.slice(store.indexOf("export function createSupabaseReads"), store.indexOf("export function createSupabaseBookkeeping"));
  const booksBody = store.slice(store.indexOf("export function createSupabaseBookkeeping"));
  assert.doesNotMatch(readsBody, /\.(insert|update|upsert|delete|rpc)\(/, "reads must not write");
  const tables = [...booksBody.matchAll(/\.from\("([a-z_]+)"\)/g)].map((m) => m[1]);
  assert.ok(tables.length > 0);
  for (const t of tables) {
    assert.ok(["scheduler_runs", "scheduler_events", "scheduler_account_checks"].includes(t), `bookkeeping writes ${t}`);
  }
  assert.doesNotMatch(booksBody, /\.rpc\(/);
});

test("nothing in the scheduler library can notify owners, call SQL functions, or write to Stripe", () => {
  const dir = fileURLToPath(new URL("./", import.meta.url));
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = readFileSync(dir + file, "utf8");
    assert.doesNotMatch(src, /from "\.\.\/notify(\.ts)?"|notifyOwner\(|notifyEmailAddress\(/, `${file} imports a notifier`);
    assert.doesNotMatch(src, /\.rpc\(/, `${file} calls a SQL function`);
    // A Stripe call is stripe.<resource>.<method>(. Supabase's .update( on the scheduler's own tables is allowed.
    assert.doesNotMatch(src, /\bstripe\.[a-zA-Z]+\.(create|update|cancel|del|pay|finalizeInvoice|voidInvoice|attach|detach|confirm|capture)\(/, `${file} calls a Stripe write`);
    if (file === "stripe-reads.ts") {
      const calls = [...src.matchAll(/\bstripe\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)].map((m) => `${m[1]}.${m[2]}`);
      assert.deepEqual([...new Set(calls)].sort(), ["invoices.list", "invoices.listLineItems", "invoices.retrieve", "subscriptions.list"]);
    }
  }
});

test("the cron route checks authorization before doing anything else", () => {
  const route = readFileSync(fileURLToPath(new URL("../../app/api/cron/daily/route.ts", import.meta.url)), "utf8");
  const auth = route.indexOf("checkCronAuthorization(");
  assert.ok(auth > 0);
  assert.ok(auth < route.indexOf("createSupabaseServiceClient("), "auth before the database");
  assert.ok(auth < route.indexOf("runScheduler("), "auth before the run");
  assert.match(route, /export const maxDuration = 800/);
});

// ── The shipped Supabase store, against a fake client ───────────────────

import { MigrationNotRunError, createSupabaseBookkeeping, createSupabaseReads } from "./store.ts";

/** Resolves every chain on a table to the scripted result for that operation. */
function fakeService(script: Record<string, Partial<Record<"select" | "insert" | "update" | "upsert", { data?: unknown; error?: { code: string; message: string } | null }>>>) {
  return {
    from(table: string) {
      let op: "select" | "insert" | "update" | "upsert" = "select";
      const chain: Record<string, unknown> = {};
      const result = () => script[table]?.[op] ?? { data: null, error: null };
      for (const m of ["select", "eq", "in", "is", "not", "lt", "lte", "gt", "gte", "order", "limit"]) chain[m] = () => chain;
      chain.insert = () => ((op = "insert"), chain);
      chain.update = () => ((op = "update"), chain);
      chain.upsert = () => ((op = "upsert"), chain);
      chain.maybeSingle = async () => result();
      chain.then = (resolve: (v: unknown) => unknown) => resolve(result());
      return chain;
    },
  } as never;
}

test("store: a second concurrent run's lease insert (23505) is an overlap, not an error", async () => {
  const books = createSupabaseBookkeeping(
    fakeService({ scheduler_runs: { update: { data: [], error: null }, insert: { data: null, error: { code: "23505", message: "duplicate" } } } }),
  );
  assert.deepEqual(await books.acquireLease({ trigger: "cron", modes: STEP_MODES, staleAfterMs: 1, now: NOW }), { overlap: true });
});

test("store: before migration 20261004 the lease throws MigrationNotRunError, and users' new columns read as null", async () => {
  const missing = { code: "PGRST205", message: "Could not find the table" };
  const books = createSupabaseBookkeeping(fakeService({ scheduler_runs: { update: { error: missing } } }));
  await assert.rejects(books.acquireLease({ trigger: "cron", modes: STEP_MODES, staleAfterMs: 1, now: NOW }), MigrationNotRunError);

  let calls = 0;
  const service = {
    from() {
      calls++;
      const res = calls === 1 ? { data: null, error: { code: "42703", message: "column users.no_plan_since does not exist" } } : { data: [{ id: "u1" }], error: null };
      return { select: () => Promise.resolve(res) };
    },
  } as never;
  const accounts = await createSupabaseReads(service).loadAccounts();
  assert.equal(accounts[0].no_plan_since, null);
  assert.equal(accounts[0].expiry_reminders_opt_out_at, null);
});
