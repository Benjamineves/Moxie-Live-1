import type Stripe from "stripe";
import { tierForPaidInvoice } from "../subscription-tier.ts";
import { NO_PLAN_WINDOW_DAYS, VESSEL_LIMIT, type SubscriptionTier } from "../tier-config.ts";
import {
  BREAKER,
  PAST_DUE_GRACE_DAYS,
  REMINDER_TIME_ZONE,
  REVIEW_NOTES,
  type ReminderThreshold,
} from "./config.ts";
import type { AccountRow, ActiveVesselRow, EffectiveState, Finding, StepResult, StripeAccountFacts } from "./types.ts";

/**
 * WHAT EACH STEP WOULD DO, FOR ONE ACCOUNT. Pure: no database, no Stripe,
 * no clock except the `now` passed in. docs/moxie_digital_scheduler_spec.md §3.
 *
 * Phase 1 only reports, so every finding here is 'would_change' (or exempt,
 * anomaly). The acting phases will apply these same decisions; they don't
 * get their own copy.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const LIVE = new Set(["active", "past_due", "trialing"]);
const HAS_PLAN = new Set(["active", "past_due"]);

function note(ownerId: string): { review_note?: string; review_until?: string } {
  const n = REVIEW_NOTES[ownerId];
  return n ? { review_note: n.label, review_until: n.untilWhen } : {};
}

function storedTier(account: AccountRow): SubscriptionTier {
  return account.subscription_tier === "full" ? "full" : "basic";
}

function storedStatus(account: AccountRow): string {
  return account.subscription_status ?? "none";
}

export function initialState(account: AccountRow, activeVesselIds: string[]): EffectiveState {
  return { status: storedStatus(account), tier: storedTier(account), activeVesselIds };
}

// ─────────────────────────────────────────────────────────────────────────
// Tier reconciliation (spec §3.1)
// ─────────────────────────────────────────────────────────────────────────

/**
 * The tier an account has paid for, from Stripe objects. The most recent
 * PAID of: (a) the subscription's latest invoice, via tierForPaidInvoice;
 * (b) a paid tier_upgrade invoice created after it, which means Full.
 * (b) is required: after a Basic -> Full upgrade the latest subscription
 * invoice is still the Basic one, and reading only (a) would downgrade
 * everyone who ever upgraded.
 */
export function paidTierFromInvoices(input: {
  subscription: Stripe.Subscription;
  latestInvoice: Stripe.Invoice | null;
  upgradeInvoices: Stripe.Invoice[];
}): { tier: SubscriptionTier | null; source: string | null } {
  const { subscription, latestInvoice } = input;
  const after = latestInvoice?.created ?? 0;
  const upgrade = input.upgradeInvoices
    .filter(
      (inv) =>
        inv.status === "paid" &&
        inv.metadata?.payment_type === "tier_upgrade" &&
        inv.metadata?.subscription_id === subscription.id &&
        inv.created >= after,
    )
    .sort((a, b) => b.created - a.created)[0];
  if (upgrade) return { tier: "full", source: upgrade.id };
  if (latestInvoice && latestInvoice.status === "paid") {
    const tier = tierForPaidInvoice(latestInvoice, subscription);
    return { tier, source: tier ? latestInvoice.id : null };
  }
  return { tier: null, source: null };
}

export function decideTier(input: {
  account: AccountRow;
  exempt: boolean;
  /** null when the account has no stripe_customer_id. */
  facts: StripeAccountFacts | null;
  /** Tier signatures recorded for this account by the latest run finished at least 20 hours ago. */
  previousSignatures: ReadonlySet<string>;
  state: EffectiveState;
}): StepResult {
  const { account, exempt, facts, previousSignatures } = input;
  const state = { ...input.state };
  const findings: Finding[] = [];
  const status = storedStatus(account);
  const tier = storedTier(account);

  if (exempt) {
    return {
      findings: [{ step: "tier", kind: "exempt", signature: "tier:exempt", detail: { reason: "lib/billing-exempt.ts" } }],
      next: state,
    };
  }

  if (!facts) {
    if (HAS_PLAN.has(status)) {
      return {
        findings: [
          {
            step: "tier",
            kind: "anomaly",
            signature: "tier:plan_without_customer",
            detail: { stored_status: status, stored_tier: tier, reason: "active or past_due with no Stripe customer, and not on the exempt list", ...note(account.id) },
          },
        ],
        next: state,
        stop: "tier: plan set with no Stripe customer",
      };
    }
    return { findings, next: state };
  }

  if (facts.kind === "customer_missing") {
    // Never "no plan". A customer Stripe can't find (deleted, or a test-mode
    // id read with live keys) says nothing about whether the owner pays.
    return {
      findings: [
        {
          step: "tier",
          kind: "anomaly",
          signature: "tier:customer_missing",
          detail: { customer: account.stripe_customer_id, stripe: facts.detail, ...note(account.id) },
        },
      ],
      next: state,
      stop: "tier: Stripe customer not found",
    };
  }

  if (facts.multipleLive) {
    return {
      findings: [
        {
          step: "tier",
          kind: "anomaly",
          signature: "tier:multiple_live_subscriptions",
          detail: { subscriptions: facts.subscriptions.filter((s) => LIVE.has(s.status)).map((s) => s.id), ...note(account.id) },
        },
      ],
      next: state,
      stop: "tier: more than one live subscription",
    };
  }

  const downward = (signature: string) => previousSignatures.has(signature);

  // Status.
  const stripeStatus = facts.live
    ? facts.live.status === "past_due"
      ? "past_due"
      : "active"
    : facts.subscriptions.length > 0
      ? "canceled"
      : "none";

  if (HAS_PLAN.has(status) && !HAS_PLAN.has(stripeStatus)) {
    const signature = `status:${status}->canceled`;
    const now = downward(signature);
    findings.push({
      step: "tier",
      kind: "would_change",
      signature,
      removesAccess: true,
      detail: {
        from: status,
        to: "canceled",
        action: "lapse: status canceled, tier basic, set_vessels_lapsed",
        applies: now ? "this run (also seen on a run at least 20 hours earlier)" : "next run, if still present (two-run rule)",
        ...note(account.id),
      },
    });
    if (now) {
      state.status = "canceled";
      state.tier = "basic";
    }
  } else if (!HAS_PLAN.has(status) && stripeStatus === "active") {
    findings.push({
      step: "tier",
      kind: "would_change",
      signature: `status:${status}->active`,
      detail: { from: status, to: "active", action: "status active, clear_vessels_lapsed", applies: "this run", ...note(account.id) },
    });
    state.status = "active";
  } else if (status === "active" && stripeStatus === "past_due") {
    findings.push({
      step: "tier",
      kind: "would_change",
      signature: "status:active->past_due",
      detail: { from: "active", to: "past_due", action: "status past_due; past_due_since = now() if null", applies: "this run", ...note(account.id) },
    });
    state.status = "past_due";
  } else if (status === "past_due" && stripeStatus === "active") {
    findings.push({
      step: "tier",
      kind: "would_change",
      signature: "status:past_due->active",
      detail: { from: "past_due", to: "active", action: "status active, clear_vessels_lapsed", applies: "this run", ...note(account.id) },
    });
    state.status = "active";
  }

  // Tier — only while a plan is live and something paid decides it.
  if (facts.live && HAS_PLAN.has(state.status)) {
    if (facts.paidTier === null) {
      findings.push({
        step: "tier",
        kind: "anomaly",
        signature: "tier:undetermined",
        detail: { stored_tier: tier, subscription: facts.live.id, reason: "no paid invoice decides the tier; left alone", ...note(account.id) },
      });
    } else if (facts.paidTier !== tier) {
      const signature = `tier:${tier}->${facts.paidTier}`;
      const isDown = facts.paidTier === "basic";
      const now = !isDown || downward(signature);
      findings.push({
        step: "tier",
        kind: "would_change",
        signature,
        removesAccess: isDown,
        detail: {
          from: tier,
          to: facts.paidTier,
          decided_by: facts.paidTierSource,
          action: `write ${facts.paidTier}, reconcile_vessel_overflow`,
          applies: now ? "this run" + (isDown ? " (also seen on a run at least 20 hours earlier)" : "") : "next run, if still present (two-run rule)",
          ...note(account.id),
        },
      });
      if (now) state.tier = facts.paidTier;
    }

    if (facts.live.id !== account.stripe_subscription_id) {
      findings.push({
        step: "tier",
        kind: "would_change",
        signature: "tier:subscription_id",
        detail: { from: account.stripe_subscription_id, to: facts.live.id, action: "record the live subscription id", applies: "this run", ...note(account.id) },
      });
    }
  }

  return { findings, next: state };
}

// ─────────────────────────────────────────────────────────────────────────
// Transfer-buyer (no-plan) window (spec §3.2)
// ─────────────────────────────────────────────────────────────────────────

export function decideNoPlanWindow(input: {
  account: AccountRow;
  exempt: boolean;
  state: EffectiveState;
  now: Date;
  windowDays?: number;
}): StepResult {
  const { account, exempt, now } = input;
  const state = { ...input.state };
  const windowDays = input.windowDays ?? NO_PLAN_WINDOW_DAYS;
  const holdsActive = state.activeVesselIds.length > 0;
  const inWindow = holdsActive && !LIVE.has(state.status);
  const since = account.no_plan_since ? new Date(account.no_plan_since) : null;

  if (!inWindow) {
    if (since) {
      return {
        findings: [
          {
            step: "no_plan_window",
            kind: "would_change",
            signature: "no_plan:clear",
            detail: { no_plan_since: account.no_plan_since, reason: holdsActive ? "account has a live plan" : "no active vessels", action: "clear no_plan_since" },
          },
        ],
        next: state,
      };
    }
    return { findings: [], next: state };
  }

  if (exempt) {
    return {
      findings: [{ step: "no_plan_window", kind: "exempt", signature: "no_plan:exempt", detail: { active_vessels: state.activeVesselIds.length } }],
      next: state,
    };
  }

  if (!since) {
    const deadline = new Date(now.getTime() + windowDays * DAY_MS);
    return {
      findings: [
        {
          step: "no_plan_window",
          kind: "would_change",
          signature: "no_plan:start",
          detail: {
            status: state.status,
            active_vessels: state.activeVesselIds.length,
            vessel_ids: state.activeVesselIds,
            action: "set no_plan_since = now(); notify no_plan_window_started",
            deadline: deadline.toISOString(),
            ...note(account.id),
          },
        },
      ],
      next: state,
    };
  }

  const deadline = new Date(since.getTime() + windowDays * DAY_MS);
  if (now.getTime() >= deadline.getTime()) {
    const count = state.activeVesselIds.length;
    const lapsedIds = state.activeVesselIds;
    state.activeVesselIds = [];
    return {
      findings: [
        {
          step: "no_plan_window",
          kind: "would_change",
          signature: "no_plan:lapse",
          removesAccess: true,
          pausesVessels: count,
          detail: { no_plan_since: account.no_plan_since, deadline: deadline.toISOString(), vessel_ids: lapsedIds, action: `lapse ${count} vessel(s); notify vessel_lapsed_no_plan`, ...note(account.id) },
        },
      ],
      next: state,
    };
  }

  return { findings: [], next: state };
}

// ─────────────────────────────────────────────────────────────────────────
// Dormancy (spec §3.3) — a preview of reconcile_owner_dormancy, from reads.
// Acting calls the SQL, which is the enforcement; this only says what it
// would find.
// ─────────────────────────────────────────────────────────────────────────

export function decideDormancy(input: {
  account: AccountRow;
  /** is_admin_email: the SQL cap exemption. */
  capExempt: boolean;
  state: EffectiveState;
  now: Date;
}): StepResult {
  const { account, capExempt, now } = input;
  const state = { ...input.state };
  const active = state.activeVesselIds;

  if (state.status === "past_due" && account.past_due_since) {
    const due = new Date(new Date(account.past_due_since).getTime() + PAST_DUE_GRACE_DAYS * DAY_MS);
    if (now.getTime() >= due.getTime() && active.length > 0) {
      state.activeVesselIds = [];
      return {
        findings: [
          {
            step: "dormancy",
            kind: "would_change",
            signature: "dormancy:lapse",
            removesAccess: true,
            pausesVessels: active.length,
            detail: { past_due_since: account.past_due_since, grace_ended: due.toISOString(), vessel_ids: active, action: `lapse ${active.length} vessel(s); notify vessel_lapsed`, ...note(account.id) },
          },
        ],
        next: state,
      };
    }
  }

  if (account.downgrade_grace_until && now.getTime() >= new Date(account.downgrade_grace_until).getTime()) {
    if (capExempt) {
      return {
        findings: [{ step: "dormancy", kind: "exempt", signature: "dormancy:cap_exempt", detail: { action: "clear downgrade_grace_until (is_admin_email)" } }],
        next: state,
      };
    }
    const limit = VESSEL_LIMIT[state.tier];
    const over = active.slice(limit);
    if (over.length > 0) {
      state.activeVesselIds = active.slice(0, limit);
      return {
        findings: [
          {
            step: "dormancy",
            kind: "would_change",
            signature: "dormancy:lock",
            removesAccess: true,
            pausesVessels: over.length,
            detail: { grace_until: account.downgrade_grace_until, tier: state.tier, limit, lock_vessel_ids: over, action: `lock ${over.length} vessel(s); notify vessel_locked`, ...note(account.id) },
          },
        ],
        next: state,
      };
    }
    return {
      findings: [
        {
          step: "dormancy",
          kind: "would_change",
          signature: "dormancy:clear_clock",
          detail: { grace_until: account.downgrade_grace_until, reason: "within the plan's limit now", action: "clear downgrade_grace_until" },
        },
      ],
      next: state,
    };
  }

  return { findings: [], next: state };
}

// ─────────────────────────────────────────────────────────────────────────
// Expiry reminders (spec §3.4)
// ─────────────────────────────────────────────────────────────────────────

/** The calendar date `now` falls on in `timeZone`, as YYYY-MM-DD. */
export function calendarDate(now: Date, timeZone: string = REMINDER_TIME_ZONE): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** Whole calendar days from today (in `timeZone`) to a YYYY-MM-DD date. Negative once past. */
export function calendarDaysUntil(date: string, now: Date, timeZone: string = REMINDER_TIME_ZONE): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date.trim());
  if (!m) return null;
  const [ty, tm, td] = calendarDate(now, timeZone).split("-").map(Number);
  return Math.round((Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - Date.UTC(ty, tm - 1, td)) / DAY_MS);
}

/**
 * Which reminder a document is due, by the window its days-remaining falls
 * in: (7, 30] -> 30, (0, 7] -> 7, 0 -> 0, anything else none. Nothing after
 * expiry. A run that was missed doesn't cause a pile-up: a document that
 * went from 31 days to 6 is in the 7-day window and gets only that one.
 */
export function reminderThresholdFor(daysRemaining: number): ReminderThreshold | null {
  if (daysRemaining < 0) return null;
  if (daysRemaining === 0) return 0;
  if (daysRemaining <= 7) return 7;
  if (daysRemaining <= 30) return 30;
  return null;
}

export function reminderKey(k: { vesselId: string; ownerId: string; docType: string; expiryDate: string; threshold: number }): string {
  return `${k.vesselId}|${k.ownerId}|${k.docType}|${k.expiryDate}|${k.threshold}`;
}

export type ReminderDoc = { vesselId: string; docType: "registration" | "insurance" | "fishing_license"; expiryDate: string };

export function datedDocuments(vessel: ActiveVesselRow): ReminderDoc[] {
  const docs: ReminderDoc[] = [];
  const day = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
  const reg = day(vessel.reg_expiry);
  const ins = day(vessel.ins_expiry);
  const fish = vessel.fishing_license_lifetime ? null : day(vessel.fishing_license_expiry);
  if (reg) docs.push({ vesselId: vessel.id, docType: "registration", expiryDate: reg });
  if (ins) docs.push({ vesselId: vessel.id, docType: "insurance", expiryDate: ins });
  if (fish) docs.push({ vesselId: vessel.id, docType: "fishing_license", expiryDate: fish });
  return docs;
}

export function decideReminders(input: {
  account: AccountRow;
  state: EffectiveState;
  vessels: ActiveVesselRow[];
  sentKeys: ReadonlySet<string>;
  now: Date;
}): StepResult & { eligibleDocuments: number } {
  const { account, state, now } = input;
  const findings: Finding[] = [];

  // Full Access only (decided 2026-09-15), on a plan, with an address, not opted out.
  if (state.tier !== "full" || !HAS_PLAN.has(state.status) || !account.email || account.expiry_reminders_opt_out_at) {
    return { findings, next: state, eligibleDocuments: 0 };
  }

  const active = new Set(state.activeVesselIds);
  let eligibleDocuments = 0;
  for (const vessel of input.vessels) {
    if (!active.has(vessel.id)) continue;
    for (const doc of datedDocuments(vessel)) {
      eligibleDocuments++;
      const days = calendarDaysUntil(doc.expiryDate, now);
      if (days === null) continue;
      const threshold = reminderThresholdFor(days);
      if (threshold === null) continue;
      const key = reminderKey({ vesselId: vessel.id, ownerId: account.id, docType: doc.docType, expiryDate: doc.expiryDate, threshold });
      if (input.sentKeys.has(key)) continue;
      findings.push({
        step: "reminders",
        kind: "would_change",
        signature: `reminder:${doc.docType}:${doc.expiryDate}:${threshold}`,
        vesselId: vessel.id,
        sendsReminder: true,
        detail: { mxe_id: vessel.mxe_id, doc: doc.docType, expiry_date: doc.expiryDate, days_remaining: days, threshold, action: "send expiry reminder" },
      });
    }
  }
  return { findings, next: state, eligibleDocuments };
}

// ─────────────────────────────────────────────────────────────────────────
// Circuit breaker (spec §5)
// ─────────────────────────────────────────────────────────────────────────

export type BreakerMeasure = { count: number; denominator: number; limit: number; trips: boolean };

/** Trips when count exceeds the larger of the floor and the proportion of the denominator. */
export function measureBreaker(count: number, denominator: number, rule: { proportion: number; floor: number }): BreakerMeasure {
  const limit = Math.max(rule.floor, Math.floor(rule.proportion * denominator));
  return { count, denominator, limit, trips: count > limit };
}

export function measureAllBreakers(input: {
  accountsLosingAccess: number;
  accountsInScope: number;
  vesselsPaused: number;
  activeVessels: number;
  reminderEmails: number;
  eligibleDocuments: number;
}) {
  return {
    accountsLosingAccess: measureBreaker(input.accountsLosingAccess, input.accountsInScope, BREAKER.accountsLosingAccess),
    vesselsPaused: measureBreaker(input.vesselsPaused, input.activeVessels, BREAKER.vesselsPaused),
    reminderEmails: measureBreaker(input.reminderEmails, input.eligibleDocuments, BREAKER.reminderEmails),
  };
}
