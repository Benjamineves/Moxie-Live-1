import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { REVIEW_NOTES, STEP_MODES, STEP_ORDER } from "@/lib/scheduler/config";
import { brief } from "@/lib/scheduler/describe";
import { decideHealth } from "@/lib/scheduler/health";
import type { Finding } from "@/lib/scheduler/types";
import { runSchedulerNow } from "./actions";

type RunRow = {
  id: string;
  trigger: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  summary: Record<string, unknown> | null;
  error: string | null;
  needs_alert: boolean;
  alerted_at: string | null;
};

type EventRow = {
  id: string;
  run_id: string;
  owner_id: string | null;
  vessel_id: string | null;
  step: Finding["step"];
  kind: Finding["kind"];
  signature: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

type Props = { searchParams: Promise<{ run?: string; error?: string }> };

const ERRORS: Record<string, string> = {
  migration: "The scheduler tables don't exist yet: migration 20261004 hasn't been run.",
  overlap: "Another run was already in progress, so this one did nothing.",
  start: "The run failed to start. Check the server logs.",
  service: "The Supabase service role isn't configured.",
};

const text = "font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]";
const cell = "px-3 py-2 align-top";

function when(iso: string) {
  return `${iso.replace("T", " ").slice(0, 16)} UTC`;
}

function asFindings(events: EventRow[]) {
  return events.map((e) => ({ step: e.step, kind: e.kind, signature: e.signature, vesselId: e.vessel_id, detail: e.detail ?? {}, owner_id: e.owner_id }));
}

/**
 * The scheduler's record, read like the digest: whether anything needs a
 * person first, then plain sentences, then the raw events for debugging.
 * docs/moxie_digital_scheduler_spec.md §7.
 */
export default async function SchedulerAdminPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");
  const service = createSupabaseServiceClient();
  if (!service) redirect("/dashboard");

  const sp = await searchParams;
  const { data: runRows, error: runsError } = await service
    .from("scheduler_runs")
    .select("id, trigger, status, started_at, finished_at, summary, error, needs_alert, alerted_at")
    .order("started_at", { ascending: false })
    .limit(30);
  const runs = (runRows ?? []) as RunRow[];
  const migrationMissing = runsError?.code === "PGRST205";

  let events: EventRow[] = [];
  if (runs.length > 0) {
    const { data } = await service
      .from("scheduler_events")
      .select("id, run_id, owner_id, vessel_id, step, kind, signature, detail, created_at")
      .in("run_id", runs.map((r) => r.id))
      .order("created_at", { ascending: true })
      .limit(5000);
    events = (data ?? []) as EventRow[];
  }
  const eventsByRun = new Map<string, EventRow[]>();
  for (const e of events) {
    if (!eventsByRun.has(e.run_id)) eventsByRun.set(e.run_id, []);
    eventsByRun.get(e.run_id)!.push(e);
  }
  const briefFor = (r: RunRow) => brief({ findings: asFindings(eventsByRun.get(r.id) ?? []), status: r.status, summary: r.summary });

  const selected = runs.find((r) => r.id === sp.run) ?? runs[0] ?? null;
  const selectedBrief = selected ? briefFor(selected) : null;

  const latestFinished = runs.find((r) => r.finished_at) ?? null;
  const health = decideHealth(latestFinished ? { status: latestFinished.status, finished_at: latestFinished.finished_at! } : null, new Date());
  const reportOnly = Object.values(STEP_MODES).every((m) => m === "report");

  const noteOwners = Object.keys(REVIEW_NOTES);
  const { data: noteUsers } = noteOwners.length
    ? await service.from("users").select("id, email").in("id", noteOwners)
    : { data: [] };
  const emailById = new Map(((noteUsers ?? []) as { id: string; email: string | null }[]).map((u) => [u.id, u.email]));

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/scheduler" />
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">Admin · Scheduler</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            {migrationMissing
              ? "Not set up yet."
              : !health.healthy
                ? "The scheduler needs you."
                : selectedBrief
                  ? selectedBrief.headline
                  : "No runs yet."}
          </h1>
          <p className={`mt-2 max-w-2xl ${text}`}>
            {migrationMissing
              ? ERRORS.migration
              : !health.healthy
                ? `It isn't healthy: ${health.reason}. The uptime monitor sees the same.`
                : selected
                  ? `${selected.id === runs[0]?.id ? "Latest run" : "Run"}: ${when(selected.started_at)}, ${selected.trigger}, ${selected.status}.`
                  : "The first run will appear here."}{" "}
            {reportOnly ? "Every step is report-only: runs record what they would do and change nothing." : null}
          </p>
        </header>

        {sp.error && ERRORS[sp.error] ? (
          <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{ERRORS[sp.error]}</p>
          </div>
        ) : null}

        {selectedBrief ? (
          <section className="mb-6 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
            {selectedBrief.needsYou.length > 0 ? (
              <>
                <h2 className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)]">Needs you</h2>
                <ul className="mt-2 mb-5 list-disc space-y-2 pl-5 font-[family-name:var(--font-dm)] text-[15px] leading-relaxed text-[var(--navy)]">
                  {selectedBrief.needsYou.map((t, i) => (
                    <li key={i}>{t}</li>
                  ))}
                </ul>
              </>
            ) : null}
            <h2 className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">No action needed</h2>
            {selectedBrief.noAction.length > 0 ? (
              <ul className="mt-2 list-disc space-y-2 pl-5 font-[family-name:var(--font-dm)] text-[15px] leading-relaxed text-[var(--text2)]">
                {selectedBrief.noAction.map((t, i) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            ) : (
              <p className={`mt-2 ${text}`}>Nothing to report on the accounts this run checked.</p>
            )}
            {selected?.error ? <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">Run error: {selected.error}</p> : null}
          </section>
        ) : null}

        <section className="mb-6 overflow-x-auto rounded-xl border border-[var(--divider)] bg-[var(--white)] shadow-sm">
          <table className="w-full min-w-[640px] text-left font-[family-name:var(--font-dm)] text-sm">
            <thead className="border-b border-[var(--divider)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
              <tr>
                <th className={cell}>Run</th>
                <th className={cell}>Needs you</th>
                <th className={cell}>For information</th>
                <th className={cell}>Status</th>
                <th className={cell}>Accounts checked</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 ? (
                <tr>
                  <td className={cell} colSpan={5}>
                    No runs yet.
                  </td>
                </tr>
              ) : (
                runs.map((r) => {
                  const b = briefFor(r);
                  return (
                    <tr key={r.id} className={`border-b border-[var(--divider)] ${selected?.id === r.id ? "bg-[var(--cream2)]" : ""}`}>
                      <td className={cell}>
                        <Link href={`/admin/scheduler?run=${r.id}`} className="text-[var(--blue-fg)] underline">
                          {when(r.started_at)}
                        </Link>{" "}
                        <span className="text-[var(--text3)]">({r.trigger})</span>
                      </td>
                      <td className={`${cell} ${b.needsYou.length > 0 ? "font-semibold text-[var(--red-fg)]" : ""}`}>{b.needsYou.length === 0 ? "Nothing" : b.needsYou.length}</td>
                      <td className={cell}>{b.noAction.length}</td>
                      <td className={cell}>{r.status}</td>
                      <td className={cell}>{String(r.summary?.accounts_visited ?? "—")}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </section>

        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">Steps</p>
            <ul className={`mt-2 ${text}`}>
              {STEP_ORDER.map((s) => (
                <li key={s}>
                  {s.replaceAll("_", " ")}: {STEP_MODES[s] === "report" ? "report-only" : "acting"}
                </li>
              ))}
            </ul>
            <form action={runSchedulerNow} className="mt-3">
              <button
                type="submit"
                className="rounded-lg bg-[var(--navy)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-white"
              >
                Run now
              </button>
            </form>
          </div>
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">Known accounts</p>
            {noteOwners.length === 0 ? (
              <p className={`mt-2 ${text}`}>None. No account&apos;s findings are being filed as already explained, so anything a run finds is new.</p>
            ) : (
              <ul className={`mt-2 ${text}`}>
                {Object.entries(REVIEW_NOTES).map(([owner, n]) => (
                  <li key={owner} className="mb-1">
                    <strong>{emailById.get(owner) ?? `${owner.slice(0, 8)}…`}</strong>: {n.label}. No action needed {n.untilWhen}.
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {selected ? (
          <details className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <summary className={`cursor-pointer ${text}`}>Raw events for this run ({(eventsByRun.get(selected.id) ?? []).length})</summary>
            <pre className="mt-3 max-h-[480px] overflow-auto whitespace-pre-wrap break-words text-xs">
              {JSON.stringify(
                (eventsByRun.get(selected.id) ?? []).map((e) => ({ step: e.step, kind: e.kind, signature: e.signature, detail: e.detail })),
                null,
                2,
              )}
            </pre>
          </details>
        ) : null}
      </main>
    </div>
  );
}
