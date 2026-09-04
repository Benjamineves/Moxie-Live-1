/**
 * Expiry status for the two documents that have a date: registration
 * (reg_expiry) and insurance (ins_expiry). Both columns already exist and
 * are owner-editable — this only connects them to the documents they
 * describe.
 *
 * The boater card deliberately has no status. A CA Boater Card is valid
 * for the holder's lifetime, which is the same reason it's exempt from
 * the Basic tier's document limit.
 */

export const EXPIRING_SOON_DAYS = 60;

export type ExpiryState = "none" | "current" | "expiring" | "expired";

export type ExpiryStatus = {
  state: ExpiryState;
  /**
   * Carries the full meaning on its own — never paired with colour as the
   * only signal. "Expired Mar 2026", "Expires in 23 days", "Expires Mar
   * 2027" and "No expiry date set" are each unambiguous read aloud, with
   * no palette, for anyone who can't distinguish the states.
   */
  label: string;
  daysLeft: number | null;
};

/**
 * Postgres DATE comes back as "YYYY-MM-DD". `new Date("2027-03-15")`
 * parses that as UTC midnight, which lands on the previous day for
 * anyone west of UTC — enough to report a document as expired a day
 * early. Parsed as a local date instead.
 */
function parseLocalDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value.trim());
  if (!match) {
    const loose = new Date(value);
    return Number.isNaN(loose.getTime()) ? null : loose;
  }
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function startOfDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function monthYear(date: Date) {
  return date.toLocaleDateString(undefined, { month: "short", year: "numeric" });
}

export function getExpiryStatus(value: string | null | undefined, now: Date = new Date()): ExpiryStatus {
  if (!value || !value.trim()) {
    return { state: "none", label: "No expiry date set", daysLeft: null };
  }

  const expiry = parseLocalDate(value);
  if (!expiry) {
    return { state: "none", label: "No expiry date set", daysLeft: null };
  }

  // Whole-day granularity, so "expires today" is 0 days rather than a
  // fraction that rounds the wrong way depending on the time of day.
  const days = Math.round((startOfDay(expiry).getTime() - startOfDay(now).getTime()) / 86_400_000);

  if (days < 0) {
    return { state: "expired", label: `Expired ${monthYear(expiry)}`, daysLeft: days };
  }
  if (days <= EXPIRING_SOON_DAYS) {
    const label =
      days === 0 ? "Expires today" : days === 1 ? "Expires in 1 day" : `Expires in ${days} days`;
    return { state: "expiring", label, daysLeft: days };
  }
  return { state: "current", label: `Expires ${monthYear(expiry)}`, daysLeft: days };
}

/** Which document slots carry an expiry date at all, and which column each reads. */
export const EXPIRY_DOC_TYPES = ["registration", "insurance"] as const;
export type ExpiryDocType = (typeof EXPIRY_DOC_TYPES)[number];
