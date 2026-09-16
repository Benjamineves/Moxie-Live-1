import type { SubscriptionTier } from "./tier-config.ts";

/**
 * SERVICE RECORDS — the vessel's maintenance history.
 *
 * A separate collection from the four primary documents, which are
 * identity papers with renewal dates and are untouched by any of this.
 * What this is for is *cadence*: when the engine was last serviced, how
 * regularly the bottom is cleaned. A buyer reads the shape of the history,
 * not a folder of files.
 *
 * Pure logic only — no Supabase, no Next — so the display rules and the
 * two credibility rules can be tested without a database. The reads and
 * writes live in service-records-store.ts.
 */

/**
 * The fixed category list. NOT free text: grouping is the entire display,
 * and free text produces "Engine", "engine" and "Engine service" as three
 * separate groups within a week. Mirrored by hand in the CHECK constraint
 * in 20261005_service_records.sql — change both, and see the test that
 * fails if they drift.
 *
 * Ordered roughly by how often a boat needs each, which is also the order
 * the history renders in. "Other" is deliberately last and deliberately
 * exists: a list with no escape hatch gets abused by miscategorising into
 * whichever option is nearest, which corrupts the groups that matter.
 */
export const SERVICE_CATEGORIES = [
  { value: "engine", label: "Engine" },
  { value: "drivetrain", label: "Drivetrain" },
  { value: "hull_and_bottom", label: "Hull & bottom" },
  { value: "electrical", label: "Electrical" },
  { value: "plumbing_and_tanks", label: "Plumbing & tanks" },
  { value: "rigging_and_sails", label: "Rigging & sails" },
  { value: "safety_equipment", label: "Safety equipment" },
  { value: "electronics", label: "Electronics" },
  { value: "canvas_and_upholstery", label: "Canvas & upholstery" },
  { value: "haul_out_and_survey", label: "Haul-out & survey" },
  { value: "other", label: "Other" },
] as const;

export type ServiceCategory = (typeof SERVICE_CATEGORIES)[number]["value"];

const CATEGORY_VALUES = new Set<string>(SERVICE_CATEGORIES.map((c) => c.value));
const CATEGORY_ORDER = new Map<string, number>(SERVICE_CATEGORIES.map((c, i) => [c.value, i]));

export function isServiceCategory(value: unknown): value is ServiceCategory {
  return typeof value === "string" && CATEGORY_VALUES.has(value);
}

export function categoryLabel(value: string): string {
  return SERVICE_CATEGORIES.find((c) => c.value === value)?.label ?? "Other";
}

export type ServiceRecord = {
  id: string;
  vessel_id: string;
  logged_by: string | null;
  service_date: string;
  category: string;
  description: string;
  provider: string | null;
  /** Null for everyone but the owner who uploaded it — and null for all after a transfer. */
  file_path: string | null;
  file_name: string | null;
  file_size_bytes: number | null;
  /** True once a file has ever been attached. Survives the transfer that nulls file_path. */
  file_was_attached: boolean;
  /** System-set, immutable. The database enforces this, not us. */
  logged_at: string;
};

/** Full Access only. Basic keeps the four primary document slots. */
export const SERVICE_RECORDS_TIER: SubscriptionTier = "full";

export function tierAllowsServiceRecords(tier: SubscriptionTier | string | null | undefined): boolean {
  return tier === SERVICE_RECORDS_TIER;
}

export const DESCRIPTION_MAX = 2000;
export const PROVIDER_MAX = 200;

export type ServiceRecordInput = {
  serviceDate: string;
  category: string;
  description: string;
  provider?: string | null;
};

/**
 * Everything the database would refuse, refused earlier so the owner gets a
 * sentence instead of a constraint name. The database is still the
 * enforcement — every rule here has a CHECK behind it.
 *
 * `today` is passed in rather than read, so the future-date rule is
 * testable. A service date in the future is the one thing rejected outright
 * rather than trusted: the whole point of the record is that it describes
 * work already done.
 */
export function validateServiceRecord(
  input: ServiceRecordInput,
  today: Date,
): { ok: true; value: Required<Omit<ServiceRecordInput, "provider">> & { provider: string | null } } | { ok: false; error: string } {
  const serviceDate = (input.serviceDate ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(serviceDate)) {
    return { ok: false, error: "Enter the service date as a date." };
  }
  const parsed = new Date(`${serviceDate}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    return { ok: false, error: "That service date isn't a real date." };
  }
  const todayIso = today.toISOString().slice(0, 10);
  if (serviceDate > todayIso) {
    return { ok: false, error: "A service date can't be in the future." };
  }

  if (!isServiceCategory(input.category)) {
    return { ok: false, error: "Choose a category." };
  }

  const description = (input.description ?? "").trim();
  if (!description) return { ok: false, error: "Describe what was done." };
  if (description.length > DESCRIPTION_MAX) {
    return { ok: false, error: `Keep the description under ${DESCRIPTION_MAX} characters.` };
  }

  const provider = (input.provider ?? "").trim();
  if (provider.length > PROVIDER_MAX) {
    return { ok: false, error: `Keep the provider name under ${PROVIDER_MAX} characters.` };
  }

  return { ok: true, value: { serviceDate, category: input.category, description, provider: provider || null } };
}

export type CategoryGroup = {
  category: string;
  label: string;
  records: ServiceRecord[];
  /** How many of this group's entries have, or once had, a file. */
  withFile: number;
};

/**
 * The history, grouped by category and newest first within each group.
 *
 * Ordered by the fixed category order rather than by count or recency, so
 * the same boat's history is laid out the same way every time and a reader
 * comparing two vessels is comparing like with like. Empty categories are
 * omitted — an empty "Rigging & sails" heading says nothing.
 */
export function groupByCategory(records: ServiceRecord[]): CategoryGroup[] {
  const groups = new Map<string, ServiceRecord[]>();
  for (const r of records) {
    const key = isServiceCategory(r.category) ? r.category : "other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }
  return [...groups.entries()]
    .sort((a, b) => (CATEGORY_ORDER.get(a[0]) ?? 99) - (CATEGORY_ORDER.get(b[0]) ?? 99))
    .map(([category, list]) => ({
      category,
      label: categoryLabel(category),
      records: [...list].sort(byNewestFirst),
      withFile: list.filter(hasEvidence).length,
    }));
}

function byNewestFirst(a: ServiceRecord, b: ServiceRecord): number {
  if (a.service_date !== b.service_date) return a.service_date < b.service_date ? 1 : -1;
  // Same service date: the more recently logged entry first, so a batch
  // entered in one sitting reads in the order it was typed.
  return a.logged_at < b.logged_at ? 1 : -1;
}

/** An entry counts as having evidence if it has a file OR once had one. */
function hasEvidence(r: ServiceRecord): boolean {
  return !!r.file_path || r.file_was_attached;
}

/**
 * "14 of 22 entries have documents" — what a buyer reads instead of
 * getting the files. It makes the seller's choice legible: withholding
 * everything looks different from withholding one invoice, and both look
 * different from having nothing to show.
 */
export function attachmentSummary(records: ServiceRecord[]): { total: number; withFile: number; text: string } {
  const total = records.length;
  const withFile = records.filter(hasEvidence).length;
  if (total === 0) return { total, withFile, text: "No service records yet." };
  if (withFile === 0) {
    return { total, withFile, text: `${total} ${entries(total)}, none with a document attached.` };
  }
  if (withFile === total) {
    return {
      total,
      withFile,
      text: total === 1 ? "1 entry, with a document attached." : `All ${total} entries have a document attached.`,
    };
  }
  return { total, withFile, text: `${withFile} of ${total} entries have documents.` };
}

function entries(n: number): string {
  return n === 1 ? "entry" : "entries";
}

/**
 * How the history was built, from the logged_at dates alone.
 *
 * This is the credibility signal stated in words. It asserts nothing about
 * whether the entries are true — nothing can, short of ringing the yard —
 * only about when they were written down, which is the one thing the owner
 * could not choose. `spanDays` is the distance between the first and last
 * logged_at; a history entered in one sitting has a span near zero however
 * many years its service dates cover.
 */
export function loggingPattern(
  records: ServiceRecord[],
  now: Date,
): { kind: "none" | "single_sitting" | "ongoing"; spanDays: number; text: string } {
  if (records.length === 0) return { kind: "none", spanDays: 0, text: "No service records yet." };

  const times = records.map((r) => new Date(r.logged_at).getTime()).filter((t) => !Number.isNaN(t)).sort((a, b) => a - b);
  if (times.length === 0) return { kind: "none", spanDays: 0, text: "No service records yet." };

  const spanDays = Math.round((times[times.length - 1] - times[0]) / 86_400_000);
  const sinceFirst = Math.round((now.getTime() - times[0]) / 86_400_000);

  if (records.length === 1) {
    return { kind: "single_sitting", spanDays, text: `One entry, logged ${relativeDays(sinceFirst)}.` };
  }
  if (spanDays <= 1) {
    return {
      kind: "single_sitting",
      spanDays,
      text: `All ${records.length} entries were logged on the same day, ${relativeDays(sinceFirst)}.`,
    };
  }
  return {
    kind: "ongoing",
    spanDays,
    text: `Logged over ${relativeSpan(spanDays)}, starting ${relativeDays(sinceFirst)}.`,
  };
}

function relativeDays(days: number): string {
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} month${months === 1 ? "" : "s"} ago`;
  return `${Math.round(days / 365)} years ago`;
}

function relativeSpan(days: number): string {
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  if (months < 18) return `${months} month${months === 1 ? "" : "s"}`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}
