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
