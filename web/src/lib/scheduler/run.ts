import { isTierReconciliationExempt } from "../billing-exempt.ts";
import {
  LEASE_STALE_MS,
  RUN_BUDGET_MS,
  STEP_MODES,
  STEP_ORDER,
  TWO_RUN_MIN_AGE_MS,
  type StepMode,
  type StepName,
} from "./config.ts";
import {
  decideDormancy,
  decideNoPlanWindow,
  decideReminders,
  decideTier,
  initialState,
  measureAllBreakers,
} from "./decide.ts";
import { digestNeeded, digestSubject, renderDigestHtml, renderDigestText } from "./digest.ts";
import type { SchedulerBookkeeping, SchedulerReads, RunStatus } from "./store.ts";
import type { StripeReads } from "./stripe-reads.ts";
import type { AccountRow, ActiveVesselRow, EffectiveState, Finding, StepResult } from "./types.ts";

/**
 * THE DAILY RUN. docs/moxie_digital_scheduler_spec.md.
 *
 * Per account, four steps in order (tier -> no-plan window -> dormancy ->
 * reminders). A step that fails, or can't establish the state the next
 * one reads, stops that account's later steps — recorded as skipped — and
 * the run moves to the next account. Accounts are visited oldest-checked
 * first, and the run stops starting new ones when its time budget is spent.
 *
 * PHASE 1: REPORT-ONLY, structurally. The dependencies passed in can read,
 * and can write only the scheduler's own bookkeeping. Refuses to start if
 * any step is configured to act.
 */

export type SendDigest = (message: { to: string; subject: string; html: string; text: string }) => Promise<{ sent: boolean; detail?: string }>;

export type RunDeps = {
  trigger: "cron" | "manual";
  reads: SchedulerReads;
  books: SchedulerBookkeeping;
  stripe: StripeReads;
  sendDigest: SendDigest;
  /** is_admin_email — the SQL cap exemption, for the dormancy preview. */
  isCapExempt: (email: string | null) => boolean;
  now?: () => Date;
  modes?: Record<StepName, StepMode>;
  budgetMs?: number;
  log?: (line: string) => void;
};

export type RunResult =
  | { outcome: "overlap" }
  | { outcome: "finished"; runId: string; status: RunStatus; summary: Record<string, unknown>; digest: "sent" | "not_needed" | "failed" | "already_claimed" };

const HAS_PLAN = new Set(["active", "past_due"]);

export async function runScheduler(deps: RunDeps): Promise<RunResult> {
  const now = deps.now ?? (() => new Date());
  const modes = deps.modes ?? STEP_MODES;
  const budgetMs = deps.budgetMs ?? RUN_BUDGET_MS;
  const log = deps.log ?? ((line: string) => console.log(`[scheduler] ${line}`));

  const acting = Object.entries(modes).filter(([, m]) => m !== "report").map(([s]) => s);
  if (acting.length > 0) {
    throw new Error(`Phase 1 is report-only; no acting path exists for: ${acting.join(", ")}. Refusing to start.`);
  }

  const startedAt = now();
  const lease = await deps.books.acquireLease({ trigger: deps.trigger, modes, staleAfterMs: LEASE_STALE_MS, now: startedAt });
  if ("overlap" in lease) {
    log("another run holds the lease; this one did nothing");
    return { outcome: "overlap" };
  }
  const runId = lease.runId;

  let status: RunStatus = "succeeded";
  let runError: string | null = null;
  const allFindings: (Finding & { owner_id: string | null })[] = [];
  const summary: Record<string, unknown> = { report_only: true };

  // Digests an earlier run couldn't send.
  try {
    for (const pending of await deps.books.pendingAlerts()) {
      const findings = await deps.books.loadRunFindings(pending.id);
      await deliverDigest(deps, pending.id, {
        status: pending.status,
        trigger: "earlier run",
        startedAt: pending.finished_at ?? "",
        finishedAt: pending.finished_at,
        summary: pending.summary ?? {},
        findings,
        modes,
      }, now, log);
    }
  } catch (err) {
    log(`could not retry earlier digests: ${message(err)}`);
  }

  const stepCounts: Record<string, Record<string, number>> = {};
  const count = (f: Finding) => {
    stepCounts[f.step] ??= {};
    stepCounts[f.step][f.kind] = (stepCounts[f.step][f.kind] ?? 0) + 1;
  };

  try {
    const [accounts, vessels, checkedAt, reminderKeys, previousTier] = await Promise.all([
      deps.reads.loadAccounts(),
      deps.reads.loadActiveVessels(),
      deps.reads.loadCheckedAt(),
      deps.reads.loadReminderKeys(),
      deps.reads.loadPreviousTierSignatures(startedAt, TWO_RUN_MIN_AGE_MS),
    ]);

    const mxeById = new Map(vessels.map((v) => [v.id, v.mxe_id ?? v.id]));
    const vesselsByOwner = new Map<string, ActiveVesselRow[]>();
    for (const v of vessels) {
      if (!vesselsByOwner.has(v.owner_id)) vesselsByOwner.set(v.owner_id, []);
      vesselsByOwner.get(v.owner_id)!.push(v);
    }

    const inScope = accounts.filter((a) => {
      const owned = vesselsByOwner.get(a.id)?.length ?? 0;
      return (
        !!a.stripe_customer_id ||
        owned > 0 ||
        a.subscription_status === "past_due" ||
        !!a.downgrade_grace_until ||
        !!a.no_plan_since
      );
    });
    inScope.sort((a, b) => (checkedAt.get(a.id) ?? "").localeCompare(checkedAt.get(b.id) ?? ""));

    const accountsHoldingAccess = accounts.filter((a) => (vesselsByOwner.get(a.id)?.length ?? 0) > 0 || HAS_PLAN.has(a.subscription_status ?? "")).length;
    let eligibleDocuments = 0;
    let visited = 0;
    const notReached: string[] = [];
    const failedAccounts: string[] = [];

    for (const account of inScope) {
      if (now().getTime() - startedAt.getTime() >= budgetMs) {
        notReached.push(account.id);
        continue;
      }
      visited++;
      const owned = vesselsByOwner.get(account.id) ?? [];
      const outcome = await runPipeline(deps, account, owned, {
        previousTier: previousTier.get(account.id) ?? new Set(),
        reminderKeys,
        now: now(),
      });
      eligibleDocuments += outcome.eligibleDocuments;
      if (outcome.failed) failedAccounts.push(account.id);
      // Name the account and its vessels on the event itself, so the digest and
      // the admin page read in emails and MXE IDs — and still do later, even if
      // an email changes or a vessel moves on.
      for (const f of outcome.findings) {
        const ids = [f.detail.vessel_ids, f.detail.lock_vessel_ids].find(Array.isArray) as string[] | undefined;
        f.detail = {
          ...f.detail,
          owner_email: account.email,
          ...(ids ? { mxe_ids: ids.map((id) => mxeById.get(id) ?? id) } : {}),
        };
      }
      for (const f of outcome.findings) {
        count(f);
        allFindings.push({ ...f, owner_id: account.id });
      }
      // Bookkeeping failures end the run: without the record, nothing it did is visible.
      await deps.books.recordFindings(runId, account.id, outcome.findings);
      await deps.books.markChecked(runId, account.id, now());
    }

    if (notReached.length > 0) {
      const f: Finding = { step: "run", kind: "skipped", signature: "run:budget", detail: { reason: `time budget spent; ${notReached.length} account(s) not reached`, accounts: notReached } };
      count(f);
      allFindings.push({ ...f, owner_id: null });
      await deps.books.recordFindings(runId, null, [f]);
    }

    const losing = new Set(allFindings.filter((f) => f.removesAccess).map((f) => f.owner_id));
    summary.accounts_in_scope = inScope.length;
    summary.accounts_visited = visited;
    summary.accounts_not_reached = notReached.length;
    summary.accounts_failed = failedAccounts.length;
    summary.steps = stepCounts;
    summary.breakers = measureAllBreakers({
      accountsLosingAccess: losing.size,
      accountsInScope: accountsHoldingAccess,
      vesselsPaused: allFindings.reduce((n, f) => n + (f.pausesVessels ?? 0), 0),
      activeVessels: vessels.length,
      reminderEmails: allFindings.filter((f) => f.sendsReminder).length,
      eligibleDocuments,
    });
    status = failedAccounts.length > 0 || notReached.length > 0 ? "partial" : "succeeded";
  } catch (err) {
    status = "failed";
    runError = message(err);
    const f: Finding = { step: "run", kind: "failed", signature: "run:failed", detail: { error: runError } };
    allFindings.push({ ...f, owner_id: null });
    log(`run ${runId} failed: ${runError}`);
    try {
      await deps.books.recordFindings(runId, null, [f]);
    } catch {
      // The run row's error column still carries it.
    }
  }

  const needsAlert = digestNeeded({ status, findings: allFindings });
  const finishedAt = now();
  await deps.books.finishRun(runId, { status, summary, error: runError, needsAlert, at: finishedAt });
  log(`run ${runId} ${status}: ${JSON.stringify(summary.steps ?? {})}`);

  let digest: "sent" | "not_needed" | "failed" | "already_claimed" = "not_needed";
  if (needsAlert) {
    digest = await deliverDigest(deps, runId, {
      status,
      trigger: deps.trigger,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      summary,
      findings: allFindings,
      modes,
    }, now, log);
  }

  return { outcome: "finished", runId, status, summary, digest };
}

async function runPipeline(
  deps: RunDeps,
  account: AccountRow,
  owned: ActiveVesselRow[],
  ctx: { previousTier: ReadonlySet<string>; reminderKeys: ReadonlySet<string>; now: Date },
): Promise<{ findings: Finding[]; eligibleDocuments: number; failed: boolean }> {
  const findings: Finding[] = [];
  let state: EffectiveState = initialState(account, owned.map((v) => v.id));
  let eligibleDocuments = 0;
  let failed = false;
  const exempt = isTierReconciliationExempt(account.id);

  const steps: Record<StepName, () => Promise<StepResult>> = {
    tier: async () => {
      const facts = account.stripe_customer_id ? await deps.stripe.accountFacts(account.stripe_customer_id) : null;
      return decideTier({ account, exempt, facts, previousSignatures: ctx.previousTier, state });
    },
    no_plan_window: async () => decideNoPlanWindow({ account, exempt, state, now: ctx.now }),
    dormancy: async () => decideDormancy({ account, capExempt: deps.isCapExempt(account.email), state, now: ctx.now }),
    reminders: async () => {
      const r = decideReminders({ account, state, vessels: owned, sentKeys: ctx.reminderKeys, now: ctx.now });
      eligibleDocuments = r.eligibleDocuments;
      return r;
    },
  };

  for (let i = 0; i < STEP_ORDER.length; i++) {
    const step = STEP_ORDER[i];
    let result: StepResult;
    try {
      result = await steps[step]();
    } catch (err) {
      failed = true;
      findings.push({ step, kind: "failed", signature: `${step}:failed`, detail: { error: message(err) } });
      for (const later of STEP_ORDER.slice(i + 1)) {
        findings.push({ step: later, kind: "skipped", signature: `${later}:skipped`, detail: { reason: `depends on ${step}, which failed` } });
      }
      break;
    }
    findings.push(...result.findings);
    state = result.next;
    if (result.stop) {
      for (const later of STEP_ORDER.slice(i + 1)) {
        findings.push({ step: later, kind: "skipped", signature: `${later}:skipped`, detail: { reason: result.stop } });
      }
      break;
    }
  }

  return { findings, eligibleDocuments, failed };
}

async function deliverDigest(
  deps: RunDeps,
  runId: string,
  input: { status: string; trigger: string; startedAt: string; finishedAt: string | null; summary: Record<string, unknown>; findings: (Finding & { owner_id: string | null })[]; modes: Record<StepName, StepMode> },
  now: () => Date,
  log: (line: string) => void,
): Promise<"sent" | "failed" | "already_claimed"> {
  if (!(await deps.books.claimAlert(runId, now()))) return "already_claimed";
  try {
    const recipients = await deps.reads.loadAdminRecipients();
    if (recipients.length === 0) throw new Error("no admin account with an email to send the digest to");
    const digestInput = { runId, ...input };
    const subject = digestSubject(digestInput);
    const html = renderDigestHtml(digestInput);
    const text = renderDigestText(digestInput);
    let anySent = false;
    const failures: string[] = [];
    for (const r of recipients) {
      const res = await deps.sendDigest({ to: r.email, subject, html, text });
      if (res.sent) anySent = true;
      else failures.push(`${r.email}: ${res.detail ?? "not sent"}`);
    }
    if (!anySent) throw new Error(`digest not sent: ${failures.join("; ")}`);
    return "sent";
  } catch (err) {
    log(`digest for run ${runId} failed, will retry next run: ${message(err)}`);
    await deps.books.releaseAlert(runId).catch(() => {});
    return "failed";
  }
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

