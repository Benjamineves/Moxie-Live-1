/**
 * THE SCHEDULER'S SWITCHES. docs/moxie_digital_scheduler_spec.md.
 *
 * Code, not environment variables, so switching a step from report-only to
 * acting is a reviewed commit rather than a dashboard toggle (spec §10).
 *
 * PHASE 1: EVERY STEP REPORTS. No acting code exists yet — the pipeline's
 * store interfaces have no method that writes account state, vessels,
 * Stripe or email to owners — and runScheduler refuses to start if any
 * step here is set to "act". Turning a step on means building its acting
 * path first.
 */

export type StepName = "tier" | "no_plan_window" | "dormancy" | "reminders";
export type StepMode = "report" | "act";

/** Per account, in this order (spec §2). */
export const STEP_ORDER: readonly StepName[] = ["tier", "no_plan_window", "dormancy", "reminders"];

export const STEP_MODES: Record<StepName, StepMode> = {
  tier: "report",
  no_plan_window: "report",
  dormancy: "report",
  reminders: "report",
};

/** Stop starting new accounts after this long; Vercel's limit is maxDuration (800s) on the route. */
export const RUN_BUDGET_MS = 600_000;

/** A run still 'running' after this long was killed (maxDuration + 60s). */
export const LEASE_STALE_MS = 860_000;

/** The health endpoint's window: a daily run plus two hours' slack (spec §7). */
export const HEALTH_WINDOW_MS = 26 * 60 * 60 * 1000;

/** A downward correction applies only if a run at least this old saw the same drift (spec §3.1). */
export const TWO_RUN_MIN_AGE_MS = 20 * 60 * 60 * 1000;

/** Days before expiry; nothing after (spec §3.4, decided 2026-09-15). */
export const REMINDER_THRESHOLDS = [30, 7, 0] as const;
export type ReminderThreshold = (typeof REMINDER_THRESHOLDS)[number];

/** Calendar dates for "days remaining" are read in this zone, never the server's UTC. */
export const REMINDER_TIME_ZONE = "America/Los_Angeles";

/** Past-due grace before a lapse. Mirrors DORMANCY.PAST_DUE_GRACE_DAYS and the SQL literal. */
export const PAST_DUE_GRACE_DAYS = 7;

/**
 * Circuit breaker: trips on a proportion, with a floor so a single routine
 * event can't trip it while the business is small (spec §5).
 */
export const BREAKER = {
  accountsLosingAccess: { proportion: 0.05, floor: 2 },
  vesselsPaused: { proportion: 0.05, floor: 5 },
  reminderEmails: { proportion: 0.5, floor: 10 },
} as const;

/**
 * Accounts whose findings are known and explained. The digest and
 * /admin/scheduler list a known account's would-change findings under "no
 * action needed", with this label, so a week of report-only digests doesn't
 * re-raise what's already understood. A note is not an exemption: the
 * finding is still recorded, still listed, and still blocks switching its
 * step on. Anomalies and failures on a noted account still need a human.
 */
export const REVIEW_NOTES: Record<string, { label: string; untilWhen: string }> = {
  "90806ee6-7f4d-4f17-aa7a-894e9fdb07d1": {
    label: "Known test account (test data left by the upgrade bug fixed on 2 September)",
    untilWhen: "until the tier step is switched on, when it has to be resolved first",
  },
};
