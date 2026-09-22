import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BUSINESS_TYPES,
  isBusinessType,
  looksLikeEmail,
  loadCommercialInterest,
  recordCommercialInterest,
  toCsv,
  type CommercialInterestRow,
} from "./commercial-interest.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION = fileURLToPath(new URL("../../../supabase/migrations/20261009_commercial_interest.sql", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.m?ts$/.test(name) ? [path] : [];
  });
}

type Result = { data: unknown; error: { code?: string; message: string } | null };

function fakeService(rpc: Result, table: Result = { data: [], error: null }) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return rpc;
    },
    from() {
      const builder = { select: () => builder, order: () => table };
      return builder;
    },
  } as never;
  return { client, calls };
}

test("the app's email rule is the one the database enforces", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /v_email !~ '(\^[^']+\$)'/.exec(sql);
  assert.ok(match, "email CHECK not found in 20261009");
  // Same pattern, so the form never accepts what the RPC will refuse.
  assert.equal(match[1], "^[^@\\s]+@[^@\\s]+\\.[^@\\s]+$");
  for (const good of ["a@b.co", "Ben.Eves+broker@yacht-sales.example", "x@y.z"]) assert.ok(looksLikeEmail(good), good);
  for (const bad of ["", "nope", "a@b", "a b@c.d", "a@@b.co", `${"x".repeat(320)}@b.co`]) {
    assert.equal(looksLikeEmail(bad), false, bad);
  }
});

test("business types match the CHECK, and anything else is dropped", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  const listed = [...sql.matchAll(/business_type IN \(([^)]+)\)/g)][0][1].match(/'([a-z]+)'/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual(listed, [...BUSINESS_TYPES]);
  assert.equal(isBusinessType("broker"), true);
  assert.equal(isBusinessType("yacht-whisperer"), false);
  assert.equal(isBusinessType(""), false);
});

test("a refusal comes back typed; anything else throws", async () => {
  for (const [code, refusal] of [
    ["MX040", "invalid_email"],
    ["MX041", "unknown_type"],
    ["MX042", "rate_limited"],
  ] as const) {
    const { client } = fakeService({ data: null, error: { code, message: code } });
    assert.deepEqual(
      await recordCommercialInterest(client, { email: "a@b.co", businessType: null, sourcePage: "/pricing", ipHash: "h" }),
      { ok: false, refusal },
    );
  }
  const broken = fakeService({ data: null, error: { code: "57014", message: "timeout" } });
  await assert.rejects(
    recordCommercialInterest(broken.client, { email: "a@b.co", businessType: null, sourcePage: "/pricing", ipHash: "h" }),
    /timeout/,
  );
});

test("a duplicate reports created: false, which is what stops a second notification", async () => {
  const dup = fakeService({ data: [{ interest_id: "i-1", created: false }], error: null });
  assert.deepEqual(
    await recordCommercialInterest(dup.client, { email: "a@b.co", businessType: "broker", sourcePage: "/pricing", ipHash: "h" }),
    { ok: true, created: false },
  );
  assert.deepEqual(dup.calls[0].args, {
    p_email: "a@b.co",
    p_business_type: "broker",
    p_source_page: "/pricing",
    p_ip_hash: "h",
  });
  const fresh = fakeService({ data: [{ interest_id: "i-2", created: true }], error: null });
  const result = await recordCommercialInterest(fresh.client, { email: "c@d.co", businessType: null, sourcePage: "/pricing", ipHash: null });
  assert.deepEqual(result, { ok: true, created: true });
});

test("before the migration runs, the admin list is empty rather than an error", async () => {
  for (const code of ["PGRST205", "42P01"]) {
    const { client } = fakeService({ data: null, error: null }, { data: null, error: { code, message: "missing" } });
    assert.deepEqual(await loadCommercialInterest(client), []);
  }
  const broken = fakeService({ data: null, error: null }, { data: null, error: { code: "57014", message: "timeout" } });
  await assert.rejects(loadCommercialInterest(broken.client), /timeout/);
});

test("the CSV quotes, escapes, and defuses spreadsheet formulas", () => {
  const rows: CommercialInterestRow[] = [
    { email: 'we"ird@b.co', business_type: "broker", source_page: "/pricing", submitted_at: "2026-09-21T10:00:00Z", updated_at: "2026-09-21T10:00:00Z" },
    { email: "=cmd|'/c calc'!A1", business_type: null, source_page: "/pricing", submitted_at: "2026-09-20T10:00:00Z", updated_at: "2026-09-20T10:00:00Z" },
  ];
  const csv = toCsv(rows);
  const lines = csv.trimEnd().split("\r\n");
  assert.equal(lines[0], "email,business_type,source_page,submitted_at,updated_at");
  assert.match(lines[1], /^"we""ird@b\.co","broker"/);
  // A leading = would otherwise execute when the CSV is opened.
  assert.match(lines[2], /^"'=cmd/);
  assert.match(lines[2], /,"",/, "a missing business type is an empty cell, not the word null");
});

test("only lib/commercial-interest.ts touches the table or its RPC", () => {
  const pattern = /from\(\s*["']commercial_interest["']|rpc\(\s*["']record_commercial_interest["']/;
  const callers = sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file));
  assert.deepEqual(callers, ["lib/commercial-interest.ts"]);
});

test("the form is protected: honeypot, an IP gate, and the DB's own limit", () => {
  const action = readFileSync(join(SRC, "lib/commercial-interest-actions.ts"), "utf8");
  // Honeypot answers as if it worked — a bot learns nothing.
  assert.match(action, /company_website[\s\S]{0,200}return \{ status: "done" \}/);
  assert.match(action, /checkRateLimit\(`commercial-interest:\$\{ipHash\}`, \{ max: 5, windowMs: 60 \* 60_000 \}\)/);
  // The IP is hashed, never stored raw.
  assert.match(action, /createHash\("sha256"\)/);
  assert.doesNotMatch(action, /p_ip_hash: ip\b/);
  // The email is best-effort and only for genuinely new rows.
  assert.match(action, /if \(result\.created\) \{[\s\S]{0,800}try \{[\s\S]{0,600}catch/);

  const form = readFileSync(join(SRC, "components/marketing/CommercialInterestForm.tsx"), "utf8");
  assert.match(form, /name="company_website"/);
  assert.match(form, /aria-hidden/);
  const sql = readFileSync(MIGRATION, "utf8");
  assert.match(sql, /IF v_recent >= 5 THEN/);
  assert.match(sql, /IF v_recent >= 20 THEN/);
});
