import { decideHealth } from "@/lib/scheduler/health";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Polled by an external uptime monitor (spec §7). 200 "ok" when a run
 * finished succeeded or partial in the last 26 hours; 503 "stale" otherwise,
 * including when the run table can't be read. A job that silently stops is
 * the failure that matters, and nothing inside the job can report its own
 * absence.
 *
 * Unauthenticated, so it says as little as possible: the word and the last
 * finished run's time. No counts, accounts or errors.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function respond(healthy: boolean, lastFinishedAt: string | null) {
  return new Response(`${healthy ? "ok" : "stale"}\nlast_finished_run: ${lastFinishedAt ?? "none"}\n`, {
    status: healthy ? 200 : 503,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}

export async function GET() {
  const service = requireSupabaseServiceClient("app/api/health/scheduler/route");
  const { data, error } = await service
    .from("scheduler_runs")
    .select("status, finished_at")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) return respond(false, null);

  const health = decideHealth((data as { status: string; finished_at: string } | null) ?? null, new Date());
  return respond(health.healthy, health.lastFinishedAt);
}
