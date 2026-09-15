/**
 * THE SCHEDULER, RUN FOR REAL, RECORDING NOTHING.
 *
 * Runs the shipped runScheduler with the shipped Supabase reads and Stripe
 * reads, so what it prints is what a production run would record. The only
 * substitutions are at the edges that write: bookkeeping is kept in memory
 * instead of scheduler_runs/scheduler_events, and the digest is printed
 * instead of emailed.
 *
 * Works before migration 20261004 (the scheduler tables are faked here, and
 * the new users columns read as null).
 *
 *   node --env-file=.env.local scripts/scheduler-dry-run.mts
 */
import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";
import { runScheduler } from "../src/lib/scheduler/run.ts";
import { createSupabaseReads, type SchedulerBookkeeping, type SchedulerReads } from "../src/lib/scheduler/store.ts";
import { createStripeReads } from "../src/lib/scheduler/stripe-reads.ts";
import type { Finding } from "../src/lib/scheduler/types.ts";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!url || !key || !stripeKey) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and STRIPE_SECRET_KEY.");
  process.exit(1);
}

const service = createClient(url, key, { auth: { persistSession: false } });
const realReads = createSupabaseReads(service as never);

// Scheduler-table reads fall back to empty before the migration.
const reads: SchedulerReads = {
  ...realReads,
  loadCheckedAt: () => realReads.loadCheckedAt().catch(() => new Map()),
  loadPreviousTierSignatures: (now, age) => realReads.loadPreviousTierSignatures(now, age).catch(() => new Map()),
};

const recorded: (Finding & { owner_id: string | null })[] = [];
const books: SchedulerBookkeeping = {
  acquireLease: async () => ({ runId: "dry-run" }),
  recordFindings: async (_run, owner, findings) => {
    for (const f of findings) recorded.push({ ...f, owner_id: owner });
  },
  markChecked: async () => {},
  finishRun: async () => {},
  claimAlert: async () => true,
  releaseAlert: async () => {},
  pendingAlerts: async () => [],
  loadRunFindings: async () => [],
};

const allow = (process.env.ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);

const result = await runScheduler({
  trigger: "manual",
  reads,
  books,
  stripe: createStripeReads(new Stripe(stripeKey)),
  isCapExempt: (email) => !!email && allow.includes(email.toLowerCase()),
  sendDigest: async (m) => {
    console.log(`\n── digest that would go to ${m.to} ──\nSubject: ${m.subject}\n\n${m.text}`);
    return { sent: true };
  },
  log: (line) => console.log(`[scheduler] ${line}`),
});

console.log("\n── recorded findings ──");
for (const f of recorded) {
  console.log(`${(f.owner_id ?? "run").slice(0, 8)}  ${f.step.padEnd(15)} ${f.kind.padEnd(13)} ${f.signature ?? ""}  ${JSON.stringify(f.detail)}`);
}
console.log("\n── result ──\n" + JSON.stringify(result, null, 2));
