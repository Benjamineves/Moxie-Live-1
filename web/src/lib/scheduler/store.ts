import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "../supabase/schema-stub.ts";
import type { StepMode, StepName } from "./config.ts";
import type { AccountRow, ActiveVesselRow, Finding } from "./types.ts";

/**
 * THE SCHEDULER'S DATABASE ACCESS, AND ALL OF IT.
 *
 * Phase 1 is report-only, and that is structural rather than a flag:
 * SchedulerReads only reads, and SchedulerBookkeeping only writes the
 * scheduler's own tables (scheduler_runs, scheduler_events,
 * scheduler_account_checks). Neither has a method that writes users,
 * vessels or reminder sends. An acting step can't be switched on without
 * adding one here, where it will be reviewed.
 */

export class MigrationNotRunError extends Error {
  constructor(detail: string) {
    super(`Scheduler migration 20261004 has not been run: ${detail}`);
    this.name = "MigrationNotRunError";
  }
}

export type RunStatus = "succeeded" | "partial" | "failed" | "timed_out";

export interface SchedulerReads {
  loadAccounts(): Promise<AccountRow[]>;
  loadActiveVessels(): Promise<ActiveVesselRow[]>;
  /** owner_id -> when that account last finished the pipeline. */
  loadCheckedAt(): Promise<Map<string, string>>;
  /** reminderKey()s already claimed or sent. Empty before 20261004. */
  loadReminderKeys(): Promise<Set<string>>;
  /**
   * owner_id -> tier signatures recorded by the latest run that finished at
   * least `minAgeMs` ago. The two-run rule means "still present a day later",
   * so a manual run an hour after the cron doesn't count as the second sighting.
   */
  loadPreviousTierSignatures(now: Date, minAgeMs: number): Promise<Map<string, Set<string>>>;
  /** Where the digest goes: every role = 'admin' account with an email. */
  loadAdminRecipients(): Promise<{ id: string; email: string }[]>;
}

export interface SchedulerBookkeeping {
  /** Marks stale 'running' rows timed_out, then takes the lease. */
  acquireLease(input: { trigger: "cron" | "manual"; modes: Record<StepName, StepMode>; staleAfterMs: number; now: Date }): Promise<{ runId: string } | { overlap: true }>;
  recordFindings(runId: string, ownerId: string | null, findings: Finding[]): Promise<void>;
  markChecked(runId: string, ownerId: string, at: Date): Promise<void>;
  finishRun(runId: string, result: { status: RunStatus; summary: Record<string, unknown>; error: string | null; needsAlert: boolean; at: Date }): Promise<void>;
  /** Claim-before-send: true only for the call that set alerted_at. */
  claimAlert(runId: string, at: Date): Promise<boolean>;
  /** A digest that didn't send gives its claim back, so the next run retries it. */
  releaseAlert(runId: string): Promise<void>;
  /** Finished runs that needed an alert and never got one (oldest first, a few). */
  pendingAlerts(): Promise<{ id: string; status: string; summary: Record<string, unknown> | null; finished_at: string | null }[]>;
  loadRunFindings(runId: string): Promise<(Finding & { owner_id: string | null })[]>;
}

type Service = SupabaseClient<PermissiveDatabase>;

function isMissingColumn(error: { code?: string } | null): boolean {
  return error?.code === "42703" || error?.code === "PGRST204";
}
function isMissingTable(error: { code?: string } | null): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

const ACCOUNT_COLUMNS =
  "id, email, role, subscription_status, subscription_tier, stripe_customer_id, stripe_subscription_id, past_due_since, downgrade_grace_until";

export function createSupabaseReads(service: Service): SchedulerReads {
  return {
    async loadAccounts() {
      const full = await service.from("users").select(`${ACCOUNT_COLUMNS}, no_plan_since, expiry_reminders_opt_out_at`);
      if (!full.error) return (full.data ?? []) as AccountRow[];
      if (!isMissingColumn(full.error)) throw new Error(`could not read users: ${full.error.message}`);
      // Before 20261004: the report reads the new columns as null.
      const base = await service.from("users").select(ACCOUNT_COLUMNS);
      if (base.error) throw new Error(`could not read users: ${base.error.message}`);
      return ((base.data ?? []) as Omit<AccountRow, "no_plan_since" | "expiry_reminders_opt_out_at">[]).map((r) => ({
        ...r,
        no_plan_since: null,
        expiry_reminders_opt_out_at: null,
      }));
    },

    async loadActiveVessels() {
      const { data, error } = await service
        .from("vessels")
        .select("id, owner_id, mxe_id, vessel_name, updated_at, reg_expiry, ins_expiry, fishing_license_expiry, fishing_license_lifetime")
        .eq("qr_status", "active")
        .eq("lifecycle_status", "active")
        .order("updated_at", { ascending: false });
      if (error) throw new Error(`could not read vessels: ${error.message}`);
      return (data ?? []) as ActiveVesselRow[];
    },

    async loadCheckedAt() {
      const { data, error } = await service.from("scheduler_account_checks").select("owner_id, checked_at");
      if (error) {
        if (isMissingTable(error)) throw new MigrationNotRunError("scheduler_account_checks missing");
        throw new Error(`could not read scheduler_account_checks: ${error.message}`);
      }
      return new Map(((data ?? []) as { owner_id: string; checked_at: string }[]).map((r) => [r.owner_id, r.checked_at]));
    },

    async loadReminderKeys() {
      const { data, error } = await service
        .from("expiry_reminder_sends")
        .select("vessel_id, owner_id, doc_type, expiry_date, threshold_days")
        .in("status", ["claimed", "sent"]);
      if (error) {
        if (isMissingTable(error)) return new Set();
        throw new Error(`could not read expiry_reminder_sends: ${error.message}`);
      }
      return new Set(
        ((data ?? []) as { vessel_id: string; owner_id: string; doc_type: string; expiry_date: string; threshold_days: number }[]).map(
          (r) => `${r.vessel_id}|${r.owner_id}|${r.doc_type}|${r.expiry_date}|${r.threshold_days}`,
        ),
      );
    },

    async loadPreviousTierSignatures(now, minAgeMs) {
      const { data: runs, error } = await service
        .from("scheduler_runs")
        .select("id")
        .not("finished_at", "is", null)
        .lte("finished_at", new Date(now.getTime() - minAgeMs).toISOString())
        .order("finished_at", { ascending: false })
        .limit(1);
      if (error) {
        if (isMissingTable(error)) throw new MigrationNotRunError("scheduler_runs missing");
        throw new Error(`could not read scheduler_runs: ${error.message}`);
      }
      const previous = (runs ?? [])[0] as { id: string } | undefined;
      const map = new Map<string, Set<string>>();
      if (!previous) return map;
      const { data: events, error: eventsError } = await service
        .from("scheduler_events")
        .select("owner_id, signature")
        .eq("run_id", previous.id)
        .eq("step", "tier")
        .in("kind", ["would_change", "changed"]);
      if (eventsError) throw new Error(`could not read scheduler_events: ${eventsError.message}`);
      for (const e of (events ?? []) as { owner_id: string | null; signature: string | null }[]) {
        if (!e.owner_id || !e.signature) continue;
        if (!map.has(e.owner_id)) map.set(e.owner_id, new Set());
        map.get(e.owner_id)!.add(e.signature);
      }
      return map;
    },

    async loadAdminRecipients() {
      const { data, error } = await service.from("users").select("id, email").eq("role", "admin");
      if (error) throw new Error(`could not read admin accounts: ${error.message}`);
      return ((data ?? []) as { id: string; email: string | null }[]).filter((r): r is { id: string; email: string } => !!r.email);
    },
  };
}

export function createSupabaseBookkeeping(service: Service): SchedulerBookkeeping {
  return {
    async acquireLease({ trigger, modes, staleAfterMs, now }) {
      const staleBefore = new Date(now.getTime() - staleAfterMs).toISOString();
      const stale = await service
        .from("scheduler_runs")
        .update({ status: "timed_out", finished_at: now.toISOString(), error: "still running past the lease; presumed killed at the function time limit", needs_alert: true })
        .eq("status", "running")
        .lt("started_at", staleBefore)
        .select("id");
      if (stale.error) {
        if (isMissingTable(stale.error)) throw new MigrationNotRunError("scheduler_runs missing");
        throw new Error(`could not expire stale runs: ${stale.error.message}`);
      }

      const { data, error } = await service
        .from("scheduler_runs")
        .insert({ trigger, modes, status: "running", started_at: now.toISOString() })
        .select("id")
        .maybeSingle();
      if (error) {
        if (error.code === "23505") return { overlap: true };
        if (isMissingTable(error)) throw new MigrationNotRunError("scheduler_runs missing");
        throw new Error(`could not start a run: ${error.message}`);
      }
      return { runId: (data as { id: string }).id };
    },

    async recordFindings(runId, ownerId, findings) {
      if (findings.length === 0) return;
      const rows = findings.map((f) => ({
        run_id: runId,
        owner_id: ownerId,
        vessel_id: f.vesselId ?? null,
        step: f.step,
        kind: f.kind,
        signature: f.signature,
        detail: f.detail,
      }));
      const { error } = await service.from("scheduler_events").insert(rows);
      if (error) throw new Error(`could not record scheduler events: ${error.message}`);
    },

    async markChecked(runId, ownerId, at) {
      const { error } = await service
        .from("scheduler_account_checks")
        .upsert({ owner_id: ownerId, checked_at: at.toISOString(), run_id: runId }, { onConflict: "owner_id" });
      if (error) throw new Error(`could not mark ${ownerId} checked: ${error.message}`);
    },

    async finishRun(runId, { status, summary, error: runError, needsAlert, at }) {
      const { error } = await service
        .from("scheduler_runs")
        .update({ status, summary, error: runError, needs_alert: needsAlert, finished_at: at.toISOString() })
        .eq("id", runId)
        .eq("status", "running");
      if (error) throw new Error(`could not finish run ${runId}: ${error.message}`);
    },

    async claimAlert(runId, at) {
      const { data, error } = await service
        .from("scheduler_runs")
        .update({ alerted_at: at.toISOString() })
        .eq("id", runId)
        .is("alerted_at", null)
        .select("id");
      if (error) throw new Error(`could not claim the alert for run ${runId}: ${error.message}`);
      return (data ?? []).length > 0;
    },

    async releaseAlert(runId) {
      const { error } = await service.from("scheduler_runs").update({ alerted_at: null }).eq("id", runId);
      if (error) throw new Error(`could not release the alert claim for run ${runId}: ${error.message}`);
    },

    async pendingAlerts() {
      const { data, error } = await service
        .from("scheduler_runs")
        .select("id, status, summary, finished_at")
        .eq("needs_alert", true)
        .is("alerted_at", null)
        .not("finished_at", "is", null)
        .order("finished_at", { ascending: true })
        .limit(3);
      if (error) throw new Error(`could not read pending alerts: ${error.message}`);
      return (data ?? []) as { id: string; status: string; summary: Record<string, unknown> | null; finished_at: string | null }[];
    },

    async loadRunFindings(runId) {
      const { data, error } = await service
        .from("scheduler_events")
        .select("owner_id, vessel_id, step, kind, signature, detail")
        .eq("run_id", runId)
        .order("created_at", { ascending: true });
      if (error) throw new Error(`could not read events for run ${runId}: ${error.message}`);
      return ((data ?? []) as { owner_id: string | null; vessel_id: string | null; step: Finding["step"]; kind: Finding["kind"]; signature: string | null; detail: Record<string, unknown> }[]).map(
        (r) => ({ owner_id: r.owner_id, vesselId: r.vessel_id, step: r.step, kind: r.kind, signature: r.signature, detail: r.detail }),
      );
    },
  };
}
