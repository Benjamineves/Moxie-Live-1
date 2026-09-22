import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";

/**
 * The commercial/broker interest list. One row per email; re-submitting
 * updates it. docs/moxie_digital_broker_role_spec.md is what these people
 * are waiting for.
 *
 * Every read and write goes through here — commercial-interest.test.mts
 * fails if anything else calls the RPC or touches the table — so the
 * validation, the rate limit and the "was this new?" answer have one
 * implementation. The real enforcement is in the RPC (20261009); what is
 * here is the courtesy copy that lets the form say something useful
 * before a round trip.
 */

type ServiceClient = SupabaseClient<PermissiveDatabase>;

export const BUSINESS_TYPES = ["broker", "dealer", "charter", "other"] as const;
export type BusinessType = (typeof BUSINESS_TYPES)[number];

export const BUSINESS_TYPE_LABELS: Record<BusinessType, string> = {
  broker: "Broker",
  dealer: "Dealer",
  charter: "Charter operator",
  other: "Something else",
};

export function isBusinessType(value: unknown): value is BusinessType {
  return typeof value === "string" && (BUSINESS_TYPES as readonly string[]).includes(value);
}

/**
 * Deliberately loose, and identical to the CHECK the RPC applies: one @,
 * something either side, no spaces. Anything stricter rejects real
 * addresses — and the email either reaches them or it doesn't.
 */
export function looksLikeEmail(value: string): boolean {
  const email = value.trim().toLowerCase();
  return email.length <= 320 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
}

export type SubmitRefusal = "invalid_email" | "unknown_type" | "rate_limited";

const REFUSALS: Record<string, SubmitRefusal> = {
  MX040: "invalid_email",
  MX041: "unknown_type",
  MX042: "rate_limited",
};

export type SubmitResult = { ok: true; created: boolean } | { ok: false; refusal: SubmitRefusal };

export async function recordCommercialInterest(
  service: ServiceClient,
  input: { email: string; businessType: BusinessType | null; sourcePage: string; ipHash: string | null },
): Promise<SubmitResult> {
  const { data, error } = await service.rpc("record_commercial_interest", {
    p_email: input.email,
    p_business_type: input.businessType,
    p_source_page: input.sourcePage,
    p_ip_hash: input.ipHash,
  });
  if (error) {
    const refusal = REFUSALS[error.code ?? ""];
    if (refusal) return { ok: false, refusal };
    throw new Error(`record_commercial_interest failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { created: boolean } | null;
  // `created` decides whether Ben hears about it: a duplicate is not news.
  return { ok: true, created: !!row?.created };
}

export type CommercialInterestRow = {
  email: string;
  business_type: BusinessType | null;
  source_page: string;
  submitted_at: string;
  updated_at: string;
};

/** Newest first — the admin list, and the export, read the same rows. */
export async function loadCommercialInterest(service: ServiceClient): Promise<CommercialInterestRow[]> {
  const { data, error } = await service
    .from("commercial_interest")
    .select("email, business_type, source_page, submitted_at, updated_at")
    .order("submitted_at", { ascending: false });
  if (error) {
    // Before 20261009 runs, an empty list is the truth: nobody can have signed up.
    if (error.code === "PGRST205" || error.code === "42P01") return [];
    throw new Error(`Failed to load commercial interest: ${error.message}`);
  }
  return (data ?? []) as CommercialInterestRow[];
}

/**
 * CSV for the mail merge this list exists for. Fields are quoted and inner
 * quotes doubled; a leading =, +, - or @ is prefixed with an apostrophe so
 * a spreadsheet treats it as text rather than a formula.
 */
export function toCsv(rows: CommercialInterestRow[]): string {
  const cell = (value: string | null) => {
    const v = value ?? "";
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [["email", "business_type", "source_page", "submitted_at", "updated_at"].join(",")];
  for (const r of rows) {
    lines.push([cell(r.email), cell(r.business_type), cell(r.source_page), cell(r.submitted_at), cell(r.updated_at)].join(","));
  }
  return lines.join("\r\n") + "\r\n";
}
