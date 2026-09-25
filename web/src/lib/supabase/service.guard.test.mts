import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * `createSupabaseServiceClient()` may only be CALLED from a short
 * allow-list. Everything else goes through `requireSupabaseServiceClient`,
 * which throws — so a missing service role is a 500 rather than a redirect,
 * a skipped block, or a tidy inline error.
 *
 * This is the `lib/unpaid-vessel-delete.ts` pattern: the rule is worth
 * nothing if the next page can quietly pick its own answer, and this was
 * previously decided 60 separate times in 54 files — 22 pages redirected,
 * so a config failure read as "you are not an admin" or "you have been
 * signed out"; four silently skipped their work, one of them showing an
 * owner an empty fleet; 34 actions returned an inline error. Vercel
 * reported success throughout.
 *
 * Type positions (`typeof createSupabaseServiceClient`) are fine — they
 * name the client's type, they do not obtain one.
 */

const SRC = new URL("../../", import.meta.url).pathname;

/**
 * Callers that keep the raw factory, each because it already answers with
 * its own 5xx and must not throw past its own error handling.
 */
const ALLOWED = new Map<string, string>([
  ["lib/supabase/service.ts", "defines both"],
  ["app/api/health/scheduler/route.ts", "a probe: returns 503 itself, and must answer in plain text rather than throw"],
  ["app/api/cron/daily/route.ts", "returns its own 500 so the invocation shows red in Vercel's cron log"],
  ["app/api/stripe/webhook/route.ts", "returns its own 500 so Stripe retries; throwing past the handler loses that control"],
  ["app/api/vessels/[mxeId]/documents/[docType]/route.ts", "already 503"],
  ["app/api/vessels/[mxeId]/shares/route.ts", "already 503"],
  ["app/api/vessels/[mxeId]/shares/[shareId]/route.ts", "already 503"],
  ["app/api/users/[userId]/billing/route.ts", "already 503"],
  ["app/api/vessels/[mxeId]/service-records/[recordId]/route.ts", "already 503, same shape as its documents sibling"],
]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, out);
    } else if (/\.(ts|tsx|mts)$/.test(entry) && !/\.test\.mts$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

test("only the allow-list calls createSupabaseServiceClient directly", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = file.slice(SRC.length);
    if (ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // A call, not a type position: `typeof createSupabaseServiceClient` is
    // how two files name the client's type and is not a way to get one.
    if (/(?<!typeof\s)\bcreateSupabaseServiceClient\s*\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `these must use requireSupabaseServiceClient instead:\n  ${offenders.join("\n  ")}`);
});

test("every allow-listed caller still answers with a 5xx of its own", () => {
  for (const [rel, why] of ALLOWED) {
    if (rel === "lib/supabase/service.ts") continue;
    const src = readFileSync(join(SRC, rel), "utf8");
    assert.match(src, /\b(500|503)\b/, `${rel} is allow-listed (${why}) but no longer returns a 5xx`);
  }
});

/**
 * The anon client, same rule. A null from `createSupabaseServerClient()`
 * was folded into "not signed in", so a missing anon key signed everyone
 * out; `fetchVesselByMxeId` went further and served **demo vessel data**,
 * showing a stranger a fake boat at a real MXE ID.
 */
const ANON_ALLOWED = new Map<string, string>([
  ["lib/supabase/server.ts", "defines both"],
]);

test("only the allow-list calls createSupabaseServerClient directly", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = file.slice(SRC.length);
    if (ANON_ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/(?<!typeof\s)\bcreateSupabaseServerClient\s*\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `these must use requireSupabaseServerClient instead:\n  ${offenders.join("\n  ")}`);
});

test("a missing key never becomes vessel data", () => {
  const src = readFileSync(join(SRC, "lib/vessel-service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /getDemoVessel/, "a real MXE ID must never render an invented boat");
  assert.match(src, /requireSupabaseServiceClient\(/);
});

/**
 * The anon key ships in the browser bundle, so anything it can read, anyone
 * can read — straight from /rest/v1, past every allow-list the pages apply.
 * anon had SELECT on every column of `vessels` (mailing_zip was readable);
 * 20261010 revokes it and the scan page reads with the service role. These
 * are the only callers left, and neither touches `vessels`. The waitlist
 * route left this list on 2026-09-25: RLS had silently refused every anon
 * insert, so the homepage list never stored a row.
 */
const PUBLIC_CLIENT_ALLOWED = new Map<string, string>([
  ["lib/supabase-public.ts", "defines it"],
  ["lib/owner-verify.ts", "users self-read fallback, not vessels"],
]);

test("only the allow-list reads through the anon-key public client", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = file.slice(SRC.length);
    if (PUBLIC_CLIENT_ALLOWED.has(rel)) continue;
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (/\bgetPublicSupabase\s*\(/.test(src)) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `anon has no SELECT on vessels; read with the service role and filter:\n  ${offenders.join("\n  ")}`);
});

test("the waitlist never reports success without storing", () => {
  const src = readFileSync(join(SRC, "app/api/waitlist/route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /Stored locally/, "a missing config must be a 500, not ok: true");
  assert.match(src, /requireSupabaseServiceClient\(/);
});

test("the service-role vessel read keeps the is_public row rule the anon policy applied", () => {
  const src = readFileSync(join(SRC, "lib/vessel-service.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(src, /\.from\("vessels"\)[\s\S]*?\.eq\("is_public",\s*true\)/);
});

test("a share link says it is dead only when the token says so", () => {
  // Both server_error returns are gone: config and a failed RPC now throw,
  // so "expired, revoked, or already used" is only ever the token's verdict.
  const src = readFileSync(join(SRC, "lib/share-resolve.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(src, /return\s*\{\s*error:\s*"server_error"\s*\}/);
});

test("the helper throws a named error rather than returning null", () => {
  const src = readFileSync(join(SRC, "lib/supabase/service.ts"), "utf8");
  assert.match(src, /export class ServiceRoleNotConfiguredError/);
  assert.match(src, /export function requireSupabaseServiceClient/);
  assert.match(src, /throw new ServiceRoleNotConfiguredError/);
});

test("no page or action still treats a missing service role as an answer about the visitor", () => {
  // The exact shapes this replaced. Any of them coming back means a config
  // failure is being reported as a permissions, session or empty state.
  const banned = [
    /if\s*\(!\w*[Ss]ervice\)\s*\{?\s*redirect\(/,
    /if\s*\(!\w*[Ss]ervice\)\s*return\s*\{\s*error:\s*"Missing Supabase service role/,
    /if\s*\(!\w*[Ss]ervice\)\s*notFound\(\)/,
  ];
  const offenders: string[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = file.slice(SRC.length);
    const src = readFileSync(file, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    if (banned.some((re) => re.test(src))) offenders.push(rel);
  }
  assert.deepEqual(offenders, [], `a config failure must not redirect or 404:\n  ${offenders.join("\n  ")}`);
});
