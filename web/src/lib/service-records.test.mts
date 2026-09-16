import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SERVICE_CATEGORIES,
  attachmentSummary,
  categoryLabel,
  groupByCategory,
  isServiceCategory,
  loggingPattern,
  wasEditedAfterLogging,
  tierAllowsServiceRecords,
  validateServiceRecord,
  type ServiceRecord,
} from "./service-records.ts";
import { withoutFilePaths } from "./service-records-store.ts";

const TODAY = new Date("2026-09-16T12:00:00Z");

function rec(p: Partial<ServiceRecord> & Pick<ServiceRecord, "id" | "service_date" | "category">): ServiceRecord {
  return {
    vessel_id: "v1", logged_by: "o1", description: "d", provider: null,
    file_path: null, file_name: null, file_size_bytes: null, file_was_attached: false,
    logged_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", ...p,
  };
}

// ── The fixed category list ──────────────────────────────────────────────

test("the category list matches the database CHECK constraint", () => {
  // Mirrored by hand in two places; this is what catches the drift.
  const sql = readFileSync(new URL("../../../supabase/migrations/20261005_service_records.sql", import.meta.url), "utf8");
  const block = sql.slice(sql.indexOf("category          TEXT NOT NULL CHECK"), sql.indexOf("description       TEXT"));
  const inSql = [...block.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(inSql, SERVICE_CATEGORIES.map((c) => c.value));
});

test("category values are stable identifiers, not labels", () => {
  for (const c of SERVICE_CATEGORIES) {
    assert.match(c.value, /^[a-z][a-z_]*$/, `${c.value} should be a stable snake_case key`);
    assert.ok(c.label.length > 0);
  }
  assert.equal(isServiceCategory("engine"), true);
  assert.equal(isServiceCategory("Engine"), false, "labels are not values");
  assert.equal(isServiceCategory("whatever"), false);
  assert.equal(categoryLabel("nope"), "Other", "an unknown category renders under Other, never blank");
});

// ── Validation ───────────────────────────────────────────────────────────

test("a service date in the future is refused; today is allowed", () => {
  const base = { category: "engine", description: "Oil change" };
  assert.equal(validateServiceRecord({ ...base, serviceDate: "2026-09-17" }, TODAY).ok, false);
  assert.equal(validateServiceRecord({ ...base, serviceDate: "2026-09-16" }, TODAY).ok, true);
  assert.equal(validateServiceRecord({ ...base, serviceDate: "2019-04-02" }, TODAY).ok, true, "back-dating is allowed — people log late");
});

test("category must come from the list, description must say something", () => {
  const d = { serviceDate: "2026-01-01", description: "x" };
  assert.equal(validateServiceRecord({ ...d, category: "engine" }, TODAY).ok, true);
  assert.equal(validateServiceRecord({ ...d, category: "Engine" }, TODAY).ok, false);
  assert.equal(validateServiceRecord({ serviceDate: "2026-01-01", category: "engine", description: "   " }, TODAY).ok, false);
  const long = validateServiceRecord({ serviceDate: "2026-01-01", category: "engine", description: "x".repeat(2001) }, TODAY);
  assert.equal(long.ok, false);
});

test("validation trims and normalises what it returns", () => {
  const r = validateServiceRecord({ serviceDate: " 2026-01-01 ", category: "engine", description: "  Oil change  ", provider: "  " }, TODAY);
  assert.ok(r.ok);
  assert.equal(r.value.description, "Oil change");
  assert.equal(r.value.provider, null, "an empty provider is null, not an empty string");
});

// ── Tier ─────────────────────────────────────────────────────────────────

test("Full Access only", () => {
  assert.equal(tierAllowsServiceRecords("full"), true);
  assert.equal(tierAllowsServiceRecords("basic"), false);
  assert.equal(tierAllowsServiceRecords(null), false);
  assert.equal(tierAllowsServiceRecords(undefined), false);
});

// ── Display ──────────────────────────────────────────────────────────────

test("grouping follows the fixed category order, not count or recency", () => {
  const groups = groupByCategory([
    rec({ id: "1", service_date: "2026-01-01", category: "other" }),
    rec({ id: "2", service_date: "2026-02-01", category: "engine" }),
    rec({ id: "3", service_date: "2026-03-01", category: "engine" }),
    rec({ id: "4", service_date: "2026-04-01", category: "electrical" }),
  ]);
  assert.deepEqual(groups.map((g) => g.category), ["engine", "electrical", "other"]);
  assert.deepEqual(groups[0].records.map((r) => r.id), ["3", "2"], "newest service date first");
});

test("empty categories are omitted", () => {
  const groups = groupByCategory([rec({ id: "1", service_date: "2026-01-01", category: "engine" })]);
  assert.equal(groups.length, 1);
});

test("an unknown category falls into Other rather than vanishing", () => {
  const groups = groupByCategory([rec({ id: "1", service_date: "2026-01-01", category: "legacy_value" })]);
  assert.deepEqual(groups.map((g) => g.category), ["other"]);
  assert.equal(groups[0].records.length, 1);
});

test("same service date: most recently logged first", () => {
  const groups = groupByCategory([
    rec({ id: "a", service_date: "2026-01-01", category: "engine", logged_at: "2026-01-01T09:00:00Z" }),
    rec({ id: "b", service_date: "2026-01-01", category: "engine", logged_at: "2026-01-01T10:00:00Z" }),
  ]);
  assert.deepEqual(groups[0].records.map((r) => r.id), ["b", "a"]);
});

// ── The two credibility rules ────────────────────────────────────────────

test("the attachment count is what a buyer sees instead of the files", () => {
  const records = [
    rec({ id: "1", service_date: "2026-01-01", category: "engine", file_path: "p", file_name: "n", file_was_attached: true }),
    rec({ id: "2", service_date: "2026-01-02", category: "engine" }),
    rec({ id: "3", service_date: "2026-01-03", category: "engine" }),
  ];
  assert.equal(attachmentSummary(records).text, "1 of 3 entries have documents.");
  assert.equal(attachmentSummary([]).text, "No service records yet.");
  assert.equal(attachmentSummary([records[1]]).text, "1 entry, none with a document attached.");
  assert.equal(attachmentSummary([records[0]]).text, "1 entry, with a document attached.");
});

test("after a transfer the count survives although the files are gone", () => {
  // This is the point of file_was_attached: the buyer still knows which
  // entries had evidence, and asks the seller for those specifically.
  const before = [
    rec({ id: "1", service_date: "2026-01-01", category: "engine", file_path: "p", file_name: "n", file_size_bytes: 10, file_was_attached: true }),
    rec({ id: "2", service_date: "2026-01-02", category: "engine" }),
  ];
  const after = withoutFilePaths(before);
  assert.equal(after[0].file_path, null, "the path is gone");
  assert.equal(after[0].file_name, null);
  assert.equal(after[0].file_size_bytes, null);
  assert.equal(after[0].file_was_attached, true, "but the fact of it is not");
  assert.equal(attachmentSummary(after).text, attachmentSummary(before).text);
});

test("withoutFilePaths strips every path, so no view can render one", () => {
  const stripped = withoutFilePaths([
    rec({ id: "1", service_date: "2026-01-01", category: "engine", file_path: "a/b.pdf", file_name: "b.pdf" }),
    rec({ id: "2", service_date: "2026-01-02", category: "hull_and_bottom", file_path: "c/d.pdf", file_name: "d.pdf" }),
  ]);
  assert.deepEqual(stripped.map((r) => r.file_path), [null, null]);
  assert.deepEqual(stripped.map((r) => r.file_name), [null, null]);
});

test("the logging pattern tells a steady history from a bulk import", () => {
  const now = new Date("2026-09-16T00:00:00Z");
  const sameDay = [
    rec({ id: "1", service_date: "2020-01-01", category: "engine", logged_at: "2026-09-10T09:00:00Z" }),
    rec({ id: "2", service_date: "2021-01-01", category: "engine", logged_at: "2026-09-10T09:20:00Z" }),
    rec({ id: "3", service_date: "2022-01-01", category: "engine", logged_at: "2026-09-10T09:40:00Z" }),
  ];
  const bulk = loggingPattern(sameDay, now);
  assert.equal(bulk.kind, "single_sitting", "six years of service dates entered in one sitting is still one sitting");
  assert.match(bulk.text, /same day/);

  const overTime = [
    rec({ id: "1", service_date: "2023-01-01", category: "engine", logged_at: "2023-01-05T00:00:00Z" }),
    rec({ id: "2", service_date: "2024-06-01", category: "engine", logged_at: "2024-06-04T00:00:00Z" }),
    rec({ id: "3", service_date: "2026-08-01", category: "engine", logged_at: "2026-08-03T00:00:00Z" }),
  ];
  const steady = loggingPattern(overTime, now);
  assert.equal(steady.kind, "ongoing");
  assert.ok(steady.spanDays > 1000);

  assert.equal(loggingPattern([], now).kind, "none");
});

// ── The immutability is in the database, not here ────────────────────────

test("nothing in the app writes logged_at", () => {
  // The credibility argument is only worth something if the value is out
  // of reach. The trigger enforces it; this catches an app-side path being
  // added that would look like it works.
  for (const p of ["./service-records-store.ts", "../app/dashboard/[mxeId]/service/actions.ts"]) {
    const src = readFileSync(new URL(p, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(src, /logged_at\s*:/, `${p} must never write logged_at`);
  }
});

test("the migration freezes logged_at for every role and proves it", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261005_service_records.sql", import.meta.url), "utf8");
  assert.match(sql, /NEW\.logged_at := OLD\.logged_at;/, "the trigger restores the old value");
  assert.match(sql, /BEFORE UPDATE ON public\.service_records/);
  assert.match(sql, /logged_at moved on UPDATE/, "the guard proves the freeze rather than trusting it");
  assert.match(sql, /UPDATE service_records\s*\n\s*SET file_path = NULL/, "transfer detaches files");
  assert.doesNotMatch(sql, /DELETE FROM service_records\s+WHERE vessel_id/, "transfer must not delete the history");
});

test("an edit date shows only once it differs from the logged date", () => {
  // Both are set from now() in the same transaction on insert, so they are
  // identical until someone edits.
  const fresh = rec({ id: "1", service_date: "2026-01-01", category: "engine", logged_at: "2026-01-01T09:00:00Z", updated_at: "2026-01-01T09:00:00Z" });
  assert.equal(wasEditedAfterLogging(fresh), false);

  // Same day, later: still not a revision worth flagging.
  assert.equal(wasEditedAfterLogging({ ...fresh, updated_at: "2026-01-01T18:00:00Z" }), false);

  // A later day is.
  assert.equal(wasEditedAfterLogging({ ...fresh, updated_at: "2026-03-04T09:00:00Z" }), true);
});

test("the history renders the edit date, and only then", () => {
  const src = readFileSync(new URL("../components/service/ServiceHistory.tsx", import.meta.url), "utf8");
  assert.match(src, /wasEditedAfterLogging\(r\) \?/, "guarded, not unconditional");
  assert.match(src, /Edited \{formatDate\(r\.updated_at\)\}/);
});
