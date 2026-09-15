import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { REVIEW_NOTES, STEP_MODES, STEP_ORDER } from "@/lib/scheduler/config";
import { decideHealth } from "@/lib/scheduler/health";
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
  owner_id: string | null;
  vessel_id: string | null;
  step: string;
  kind: string;
  signature: string | null;
  detail: Record<string, unknown>;
  created_at: string;
};

type Props = { searchParams: Promise<{ run?: string; error?: string }> };

const ERRORS: Record<string, string> = {
  migration: "The scheduler tables don't exist yet — migration 20261004 hasn't been run.",
  overlap: "Another run is in progress; this one did nothing.",
  start: "The run failed to start. Check the server logs.",
  service: "Supabase service role isn't configured.",
};

const cell = "px-3 py-2 align-top";
const text = "font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]";

/**
 * The scheduler's record: recent runs, what each found, and a manual run.
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

  const selected = runs.find((r) => r.id === sp.run) ?? runs[0] ?? null;
  let events: EventRow[] = [];
  if (selected) {
    const { data } = await service
      .from("scheduler_events")
      .select("id, owner_id, vessel_id, step, kind, signature, detail, created_at")
      .eq("run_id", selected.id)
      .order("created_at", { ascending: true });
    events = (data ?? []) as EventRow[];
  }

  const latestFinished = runs.find((r) => r.finished_at) ?? null;
  const health = decideHealth(latestFinished ? { status: latestFinished.status, finished_at: latestFinished.finished_at! } : null, new Date());
  const reportOnly = Object.values(STEP_MODES).every((m) => m === "report");

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/scheduler" />
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">Admin</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">Scheduler</h1>
          <p className={`mt-2 max-w-2xl ${text}`}>
            The daily run at 17:00 UTC: tier reconciliation, the no-plan window, dormancy and expiry reminders, per
            account in that order.{" "}
            {reportOnly ? <strong>Every step is report-only: runs record what they would do and change nothing.</strong> : null}
          </p>
        </header>

        {sp.error && ERRORS[sp.error] ? (
          <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{ERRORS[sp.error]}</p>
          </div>
        ) : null}

        {migrationMissing ? (
          <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{ERRORS.migration}</p>
          </div>
        ) : !health.healthy ? (
          <div className="mb-4 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Not healthy: {health.reason}. The uptime monitor sees the same.
            </p>
          </div>
        ) : null}

        <section className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">Step modes</p>
            <ul className={`mt-2 ${text}`}>
              {STEP_ORDER.map((s) => (
                <li key={s}>
                  {s}: <strong>{STEP_MODES[s]}</strong>
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
            <p className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text3)]">Known findings</p>
            <ul className={`mt-2 ${text}`}>
              {Object.entries(REVIEW_NOTES).map(([owner, n]) => (
                <li key={owner} className="mb-1">
                  <code className="text-xs">{owner.slice(0, 8)}…</code> — {n}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mb-6 overflow-x-auto rounded-xl border border-[var(--divider)] bg-[var(--white)] shadow-sm">
          <table className="w-full min-w-[720px] text-left font-[family-name:var(--font-dm)] text-sm">
            <thead className="border-b border-[var(--divider)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
              <tr>
                <th className={cell}>Started (UTC)</th>
                <th className={cell}>Trigger</th>
                <th className={cell}>Status</th>
                <th className={cell}>Visited</th>
                <th className={cell}>Digest</th>
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
                runs.map((r) => (
                  <tr key={r.id} className={`border-b border-[var(--divider)] ${selected?.id === r.id ? "bg-[var(--cream2)]" : ""}`}>
                    <td className={cell}>
                      <Link href={`/admin/scheduler?run=${r.id}`} className="text-[var(--blue-fg)] underline">
                        {r.started_at.replace("T", " ").slice(0, 19)}
                      </Link>
                    </td>
                    <td className={cell}>{r.trigger}</td>
                    <td className={cell}>{r.status}</td>
                    <td className={cell}>{String(r.summary?.accounts_visited ?? "—")}</td>
                    <td className={cell}>{r.needs_alert ? (r.alerted_at ? "sent" : "pending") : "not needed"}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        {selected ? (
          <section className="overflow-x-auto rounded-xl border border-[var(--divider)] bg-[var(--white)] shadow-sm">
            <p className={`px-3 pt-3 ${text}`}>
              Run <code className="text-xs">{selected.id}</code> · {selected.status}
              {selected.error ? ` · ${selected.error}` : ""}
            </p>
            <table className="mt-2 w-full min-w-[720px] text-left font-[family-name:var(--font-dm)] text-sm">
              <thead className="border-b border-[var(--divider)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                <tr>
                  <th className={cell}>Account</th>
                  <th className={cell}>Step</th>
                  <th className={cell}>Kind</th>
                  <th className={cell}>Finding</th>
                  <th className={cell}>Detail</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td className={cell} colSpan={5}>
                      Nothing recorded — every visited account had nothing to report.
                    </td>
                  </tr>
                ) : (
                  events.map((e) => (
                    <tr key={e.id} className="border-b border-[var(--divider)]">
                      <td className={cell}>
                        <code className="text-xs">{e.owner_id ? `${e.owner_id.slice(0, 8)}…` : "run"}</code>
                      </td>
                      <td className={cell}>{e.step}</td>
                      <td className={cell}>{e.kind}</td>
                      <td className={cell}>{e.signature}</td>
                      <td className={cell}>
                        <pre className="max-w-md whitespace-pre-wrap break-words text-xs">{JSON.stringify(e.detail, null, 1)}</pre>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </section>
        ) : null}
      </main>
    </div>
  );
}
