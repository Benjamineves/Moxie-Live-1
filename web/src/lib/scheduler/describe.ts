import type { Finding } from "./types.ts";

/**
 * FINDINGS AS SENTENCES, SORTED BY WHETHER A PERSON IS NEEDED.
 *
 * The digest and /admin/scheduler both read from here, so an admin can tell
 * in five seconds whether anything needs them. Accounts are named by email,
 * vessels by MXE ID — both snapshotted onto the event when the run records it
 * (run.ts), so a sentence reads the same later even if an email changes.
 *
 * WHAT "NEEDS YOU" MEANS
 *  - Something failed, or the scheduler couldn't establish an account's state
 *    (Stripe can't find the customer, no paid invoice names a plan, two live
 *    subscriptions, a plan with no Stripe customer).
 *  - A stored plan disagrees with what was paid, on an account nobody has
 *    explained. Either direction: a customer missing access they paid for,
 *    or holding access they didn't.
 *  - A circuit breaker would trip.
 * Everything else is the decided policy doing its job — a no-plan window
 * starting, grace ending, a reminder due — and needs nobody.
 */

export type Described = { text: string; needsYou: boolean };

type Row = Finding & { owner_id: string | null };

const STEP_NAME: Record<string, string> = {
  tier: "plan check",
  no_plan_window: "no-plan window",
  dormancy: "dormancy check",
  reminders: "expiry reminders",
  run: "run",
};

const DOC_NAME: Record<string, string> = {
  registration: "registration",
  insurance: "insurance",
  fishing_license: "fishing licence",
};

const TIER_NAME: Record<string, string> = { full: "Full", basic: "Basic" };
const STATUS_NAME: Record<string, string> = { active: "paying", past_due: "past due", none: "having no plan", canceled: "cancelled" };

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function who(f: Row): string {
  return str(f.detail?.owner_email) ?? (f.owner_id ? `account ${f.owner_id.slice(0, 8)}…` : "an account");
}

function whose(f: Row): string {
  const w = who(f);
  return `${w}'s`;
}

function day(iso: unknown): string {
  const s = str(iso);
  if (!s) return "an unknown date";
  const d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function vessels(f: Row): string {
  const mxe = Array.isArray(f.detail?.mxe_ids) ? (f.detail.mxe_ids as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (mxe.length === 0) return "";
  return ` (${mxe.join(", ")})`;
}

function count(n: unknown, noun: string): string {
  const k = typeof n === "number" ? n : Array.isArray(n) ? n.length : 0;
  return `${k} ${noun}${k === 1 ? "" : "s"}`;
}

/** "Would downgrade" in report-only; "Downgraded" once a step acts. */
function verb(f: Row, would: string, did: string): string {
  return f.kind === "changed" ? did : would;
}

function known(f: Row, text: string): Described {
  const label = str(f.detail?.review_note);
  if (!label) return { text, needsYou: true };
  const until = str(f.detail?.review_until);
  return { text: `${text} ${label} — no action needed${until ? ` ${until}` : ""}.`, needsYou: false };
}

function nextRunClause(f: Row): string {
  const applies = str(f.detail?.applies) ?? "";
  return applies.startsWith("next run") ? " It would only apply if a run tomorrow still finds this." : "";
}

/** One sentence per finding, or null for findings that aren't worth a line (skips, which the failure above them explains). */
export function describeFinding(f: Row): Described | null {
  const d = f.detail ?? {};
  const sig = f.signature ?? "";

  if (f.kind === "skipped") {
    if (sig === "run:budget") {
      return { text: `Ran out of time before checking ${count(d.accounts, "account")}. They go first on the next run.`, needsYou: false };
    }
    return null;
  }

  if (f.kind === "failed") {
    if (f.step === "run") return { text: `The run stopped before finishing: ${str(d.error) ?? "unknown error"}. Nothing after that point was checked.`, needsYou: true };
    return {
      text: `Couldn't run the ${STEP_NAME[f.step] ?? f.step} for ${who(f)}: ${str(d.error) ?? "unknown error"}. Their remaining checks were skipped and will be retried next run.`,
      needsYou: true,
    };
  }

  if (f.kind === "exempt") {
    if (f.step === "tier") return { text: `Skipped ${who(f)}: their plan is set by hand, so it isn't checked against Stripe.`, needsYou: false };
    return null;
  }

  if (f.kind === "anomaly") {
    switch (sig) {
      case "tier:customer_missing":
        return {
          text: `Stripe can't find ${whose(f)} customer record (${str(d.customer) ?? "unknown"}). Nothing was changed and their other checks were skipped. Check the customer in Stripe, or that the app is using the right Stripe keys.`,
          needsYou: true,
        };
      case "tier:plan_without_customer":
        return {
          text: `${cap(who(f))} is on an active ${TIER_NAME[str(d.stored_tier) ?? ""] ?? ""} plan with no Stripe customer, and isn't on the hand-set list. Nothing was changed. If this plan was set by hand, add the account to lib/billing-exempt.ts.`,
          needsYou: true,
        };
      case "tier:multiple_live_subscriptions":
        return {
          text: `${cap(who(f))} has more than one live subscription in Stripe (${Array.isArray(d.subscriptions) ? (d.subscriptions as string[]).join(", ") : "?"}). Nothing was changed. Cancel the extra one in Stripe.`,
          needsYou: true,
        };
      case "tier:undetermined":
        return {
          text: `Couldn't tell which plan ${who(f)} has paid for: no paid invoice names Basic or Full. Their stored ${TIER_NAME[str(d.stored_tier) ?? ""] ?? ""} plan is left alone. Check that STRIPE_PRICE_ID_BASIC_SUBSCRIPTION and STRIPE_PRICE_ID_FULL are set in Vercel.`,
          needsYou: true,
        };
      default:
        return { text: `Something unexpected on ${whose(f)} ${STEP_NAME[f.step] ?? f.step}: ${sig}.`, needsYou: true };
    }
  }

  // would_change / changed
  if (sig.startsWith("tier:") && sig.includes("->")) {
    const from = TIER_NAME[str(d.from) ?? ""] ?? str(d.from);
    const to = TIER_NAME[str(d.to) ?? ""] ?? str(d.to);
    const down = d.to === "basic";
    const text = down
      ? `${verb(f, "Would downgrade", "Downgraded")} ${who(f)} from ${from} to ${to}: they've paid for ${to} only.${nextRunClause(f)}`
      : `${verb(f, "Would upgrade", "Upgraded")} ${who(f)} from ${from} to ${to}: they've paid for ${to}, but the app shows ${from}.`;
    return known(f, text);
  }
  if (sig === "tier:subscription_id") {
    return { text: `${verb(f, "Would record", "Recorded")} ${whose(f)} live subscription (${str(d.to) ?? "?"}); the app had ${str(d.from) ?? "none"}.`, needsYou: false };
  }
  if (sig.startsWith("status:")) {
    const text =
      d.to === "canceled"
        ? `${verb(f, "Would cancel", "Cancelled")} ${whose(f)} plan and pause their vessels: Stripe has no live subscription, but the app shows them as ${STATUS_NAME[str(d.from) ?? ""] ?? str(d.from)}.${nextRunClause(f)}`
        : d.to === "past_due"
          ? `${verb(f, "Would mark", "Marked")} ${who(f)} as past due: their latest payment failed in Stripe. That starts their 7-day grace.`
          : `${verb(f, "Would mark", "Marked")} ${who(f)} as paying and restore any paused vessels: Stripe shows a live subscription, but the app shows them as ${STATUS_NAME[str(d.from) ?? ""] ?? str(d.from)}.`;
    return known(f, text);
  }

  if (sig === "no_plan:start") {
    return {
      text: `${verb(f, "Would start", "Started")} ${whose(f)} 30-day window to choose a plan: they hold ${count(d.active_vessels, "active vessel")}${vessels(f)} with no plan. If they don't subscribe, ${d.active_vessels === 1 ? "it pauses" : "they pause"} on ${day(d.deadline)}.`,
      needsYou: false,
    };
  }
  if (sig === "no_plan:lapse") {
    return { text: `${verb(f, "Would pause", "Paused")} ${whose(f)} ${count(d.vessel_ids, "vessel")}${vessels(f)}: their 30-day window to choose a plan ended on ${day(d.deadline)}.`, needsYou: false };
  }
  if (sig === "no_plan:clear") {
    return { text: `${verb(f, "Would close", "Closed")} ${whose(f)} no-plan window: ${str(d.reason) ?? "it no longer applies"}.`, needsYou: false };
  }

  if (sig === "dormancy:lapse") {
    return { text: `${verb(f, "Would pause", "Paused")} ${whose(f)} ${count(d.vessel_ids, "vessel")}${vessels(f)}: their payment has been past due since ${day(d.past_due_since)}, beyond the 7-day grace.`, needsYou: false };
  }
  if (sig === "dormancy:lock") {
    return {
      text: `${verb(f, "Would pause", "Paused")} ${Array.isArray(d.lock_vessel_ids) ? d.lock_vessel_ids.length : 0} of ${whose(f)} vessels${vessels(f)}: their 14-day window to get within the ${TIER_NAME[str(d.tier) ?? ""] ?? ""} limit of ${d.limit} ended on ${day(d.grace_until)}.`,
      needsYou: false,
    };
  }
  if (sig === "dormancy:clear_clock") {
    return { text: `${verb(f, "Would close", "Closed")} ${whose(f)} downgrade window: they're within their plan's vessel limit now.`, needsYou: false };
  }

  if (sig.startsWith("reminder:")) {
    const days = typeof d.days_remaining === "number" ? d.days_remaining : null;
    const when = days === 0 ? "today" : days === 1 ? "tomorrow" : `in ${days} days`;
    return {
      text: `${verb(f, "Would email", "Emailed")} ${who(f)} that ${str(d.mxe_id) ?? "a vessel"}'s ${DOC_NAME[str(d.doc) ?? ""] ?? "document"} expires ${when} (${day(d.expiry_date)}).`,
      needsYou: false,
    };
  }

  return { text: `${cap(STEP_NAME[f.step] ?? f.step)} for ${who(f)}: ${sig}.`, needsYou: true };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export type Briefing = {
  /** The one line an admin reads first. */
  headline: string;
  needsYou: string[];
  noAction: string[];
};

export function brief(input: { findings: Row[]; status: string; summary?: Record<string, unknown> | null }): Briefing {
  const needsYou: string[] = [];
  const noAction: string[] = [];
  // Skips by design (accounts set by hand) go after everything else: true, but the least interesting line.
  const skippedByDesign: string[] = [];
  const seenExempt = new Set<string>();

  if (input.status === "timed_out") needsYou.push("The run was cut off at the time limit before it could finish. The next run marks where it stopped and carries on.");

  // One cause, many accounts: when no paid invoice names a plan it is almost
  // always configuration (a price id missing in Vercel), so it's one line
  // naming the accounts, not one line per account.
  const undetermined = input.findings.filter((f) => f.kind === "anomaly" && f.signature === "tier:undetermined");
  if (undetermined.length > 1) {
    needsYou.push(
      `Couldn't tell which plan ${undetermined.length} accounts have paid for (${undetermined.map(who).join(", ")}): no paid invoice names Basic or Full. Their stored plans are left alone. That usually means STRIPE_PRICE_ID_BASIC_SUBSCRIPTION or STRIPE_PRICE_ID_FULL isn't set in Vercel.`,
    );
  }

  for (const f of input.findings) {
    if (undetermined.length > 1 && f.kind === "anomaly" && f.signature === "tier:undetermined") continue;
    if (f.kind === "exempt") {
      const key = f.owner_id ?? "";
      if (seenExempt.has(key)) continue;
      seenExempt.add(key);
    }
    const d = describeFinding(f);
    if (!d) continue;
    (d.needsYou ? needsYou : f.kind === "exempt" ? skippedByDesign : noAction).push(d.text);
  }
  noAction.push(...skippedByDesign);

  const breakers = input.summary?.breakers as Record<string, { count: number; limit: number; trips: boolean }> | undefined;
  const BREAKER_NAME: Record<string, string> = {
    accountsLosingAccess: "accounts losing access",
    vesselsPaused: "vessels paused",
    reminderEmails: "reminder emails",
  };
  for (const [k, b] of Object.entries(breakers ?? {})) {
    if (b.trips) needsYou.push(`The circuit breaker would trip on ${BREAKER_NAME[k] ?? k}: ${b.count} in one run, above the limit of ${b.limit}. Check this is real before the step acts.`);
  }

  const n = needsYou.length;
  const headline = n === 0 ? "Nothing needs you." : `${n === 1 ? "1 thing needs" : `${n} things need`} you.`;
  return { headline, needsYou, noAction };
}
