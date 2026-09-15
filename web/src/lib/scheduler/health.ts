import { HEALTH_WINDOW_MS } from "./config.ts";

export type FinishedRun = { status: string; finished_at: string } | null;

/**
 * What the uptime monitor is told (spec §7). Healthy when the most recent
 * FINISHED run ended succeeded or partial within the window. partial counts:
 * the job ran, and failed accounts already email the admins — the monitor
 * answers "is it running", not "was every account clean". A latest run
 * that failed or timed out, or none at all, is unhealthy.
 */
export function decideHealth(latest: FinishedRun, now: Date): { healthy: boolean; lastFinishedAt: string | null; reason: string } {
  if (!latest) return { healthy: false, lastFinishedAt: null, reason: "no finished run" };
  const age = now.getTime() - new Date(latest.finished_at).getTime();
  if (latest.status !== "succeeded" && latest.status !== "partial") {
    return { healthy: false, lastFinishedAt: latest.finished_at, reason: `latest run ${latest.status}` };
  }
  if (!(age <= HEALTH_WINDOW_MS)) {
    return { healthy: false, lastFinishedAt: latest.finished_at, reason: "no run finished in the last 26 hours" };
  }
  return { healthy: true, lastFinishedAt: latest.finished_at, reason: "ok" };
}
