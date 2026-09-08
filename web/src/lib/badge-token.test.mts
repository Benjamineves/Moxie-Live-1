/**
 * Tests for badge-token.ts. Run with `npm test`.
 *
 * Node's built-in runner and TypeScript support — no test framework is
 * installed, and one is deliberately not being added for this. The repo
 * had no test infrastructure before stage 2, and picking vitest or jest
 * on behalf of the whole project as a side effect of shipping a token
 * generator would be a bigger decision than this change deserves.
 * node:test costs nothing, adds no dependency to the Vercel build, and
 * can be replaced later by whatever the project actually chooses.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  BADGE_TOKEN_LENGTH,
  BADGE_TOKEN_PATTERN,
  BadgeTokenExhaustionError,
  generateBadgeToken,
  generateUniqueBadgeTokens,
  isValidBadgeToken,
  normalizeBadgeToken,
} from "./badge-token.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

test("generated tokens always satisfy the format contract", () => {
  for (let i = 0; i < 5_000; i += 1) {
    const token = generateBadgeToken();
    assert.equal(token.length, BADGE_TOKEN_LENGTH);
    assert.ok(BADGE_TOKEN_PATTERN.test(token), `bad token: ${token}`);
  }
});

test("the ambiguous Crockford characters never appear", () => {
  // I/L/O/U are excluded precisely because they are confusable in print.
  // A regression here would produce badges that are misread rather than
  // badges that fail — much worse, and invisible until someone squints.
  const banned = /[ILOU]/;
  for (let i = 0; i < 5_000; i += 1) {
    assert.ok(!banned.test(generateBadgeToken()), "token contained I, L, O or U");
  }
});

test("every alphabet symbol is reachable, and none is over-represented", () => {
  // This is the modulo-bias regression test. `byte & 31` is exactly
  // uniform; `byte % 58`-style code is not. With 20k tokens x 9 chars =
  // 180k draws over 32 symbols, expected is 5625 each, and a biased
  // implementation blows straight through a +/-15% band.
  const SAMPLES = 20_000;
  const counts = new Map<string, number>();
  for (let i = 0; i < SAMPLES; i += 1) {
    for (const ch of generateBadgeToken()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }

  assert.equal(counts.size, 32, `expected all 32 symbols, saw ${counts.size}`);

  const expected = (SAMPLES * BADGE_TOKEN_LENGTH) / 32;
  for (const [symbol, seen] of counts) {
    const drift = Math.abs(seen - expected) / expected;
    assert.ok(drift < 0.15, `symbol ${symbol} appeared ${seen} times, expected ~${expected} (drift ${(drift * 100).toFixed(1)}%)`);
  }
});

test("100k tokens contain no duplicate", () => {
  const seen = new Set<string>();
  for (let i = 0; i < 100_000; i += 1) seen.add(generateBadgeToken());
  assert.equal(seen.size, 100_000);
});

test("the format pattern matches the database CHECK constraint exactly", () => {
  // The drift this guards against is real and would be silent: the app
  // generating tokens the database rejects, or accepting at /s/<token>
  // a shape the database could never have stored.
  const sql = readFileSync(resolve(HERE, "../../../supabase/migrations/20260921_badge_identities.sql"), "utf8");
  // Indexed rather than a named capture group: tsconfig targets ES2017,
  // which predates named groups.
  const match = /token\s+TEXT NOT NULL UNIQUE CHECK \(token ~ '([^']+)'\)/.exec(sql);
  assert.ok(match?.[1], "could not find the token CHECK constraint in the migration");
  assert.equal(
    match[1],
    BADGE_TOKEN_PATTERN.source,
    "badge-token.ts and the migration disagree about what a valid token looks like",
  );
});

test("isValidBadgeToken enforces length, alphabet and case", () => {
  assert.ok(isValidBadgeToken("K7M2QP9XR"));
  assert.ok(isValidBadgeToken("000000000"));
  assert.ok(!isValidBadgeToken("K7M2QP9X"), "8 chars must be rejected");
  assert.ok(!isValidBadgeToken("K7M2QP9XRT"), "10 chars must be rejected");
  assert.ok(!isValidBadgeToken("k7m2qp9xr"), "lowercase is not canonical");
  assert.ok(!isValidBadgeToken("K7M2QP9XI"), "I is not in the alphabet");
  assert.ok(!isValidBadgeToken("K7M2QP9XL"), "L is not in the alphabet");
  assert.ok(!isValidBadgeToken("K7M2QP9XO"), "O is not in the alphabet");
  assert.ok(!isValidBadgeToken("K7M2QP9XU"), "U is not in the alphabet");
  assert.ok(!isValidBadgeToken("K7M2QP9X-"), "punctuation is not in the alphabet");
});

test("normalizeBadgeToken uppercases and trims, and rejects everything else", () => {
  assert.equal(normalizeBadgeToken("k7m2qp9xr"), "K7M2QP9XR");
  assert.equal(normalizeBadgeToken("  K7M2QP9XR  "), "K7M2QP9XR");
  assert.equal(normalizeBadgeToken("K7M2QP9XR"), "K7M2QP9XR");

  assert.equal(normalizeBadgeToken(null), null);
  assert.equal(normalizeBadgeToken(undefined), null);
  assert.equal(normalizeBadgeToken(""), null);
  assert.equal(normalizeBadgeToken("K7M2QP9X"), null, "wrong length");
  assert.equal(normalizeBadgeToken("../../etc/passwd"), null, "path traversal is just an invalid token");

  // Documents the deliberate choice NOT to apply Crockford's I->1 / O->0
  // decoding. Nothing asks a human to type a token, so tolerance for
  // mistyping buys nothing and only widens what counts as valid.
  assert.equal(normalizeBadgeToken("K7M2QP9XO"), null, "O is not silently decoded to 0");
  assert.equal(normalizeBadgeToken("K7M2QP9XI"), null, "I is not silently decoded to 1");
});

test("generateUniqueBadgeTokens returns exactly count distinct tokens", async () => {
  const tokens = await generateUniqueBadgeTokens(100, async () => []);
  assert.equal(tokens.length, 100);
  assert.equal(new Set(tokens).size, 100);
  for (const token of tokens) assert.ok(isValidBadgeToken(token));
});

test("generateUniqueBadgeTokens retries around reported collisions", async () => {
  // Reject the first candidate of the first two rounds, then accept.
  // Proves the shortfall is regenerated rather than returned short.
  let round = 0;
  const rejected: string[] = [];
  const tokens = await generateUniqueBadgeTokens(5, async (candidates) => {
    round += 1;
    if (round > 2) return [];
    rejected.push(candidates[0]);
    return [candidates[0]];
  });

  assert.equal(tokens.length, 5);
  assert.equal(new Set(tokens).size, 5);
  assert.ok(round >= 3, `expected at least 3 rounds, saw ${round}`);
  for (const token of rejected) {
    assert.ok(!tokens.includes(token), "a token reported as taken was returned anyway");
  }
});

test("generateUniqueBadgeTokens asks the database once per round, not once per token", async () => {
  let calls = 0;
  let largestBatch = 0;
  await generateUniqueBadgeTokens(50, async (candidates) => {
    calls += 1;
    largestBatch = Math.max(largestBatch, candidates.length);
    return [];
  });
  assert.equal(calls, 1, "a clean mint of 50 should cost exactly one round trip");
  assert.equal(largestBatch, 50);
});

test("generateUniqueBadgeTokens throws rather than reusing or returning short", async () => {
  // Everything is always taken — the pathological case.
  await assert.rejects(
    () => generateUniqueBadgeTokens(3, async (candidates) => candidates, 4),
    (error: unknown) => {
      assert.ok(error instanceof BadgeTokenExhaustionError);
      assert.match((error as Error).message, /3 unique badge token\(s\) in 4 attempts/);
      return true;
    },
  );
});

test("generateUniqueBadgeTokens rejects a nonsensical count", async () => {
  await assert.rejects(() => generateUniqueBadgeTokens(0, async () => []), /positive integer/);
  await assert.rejects(() => generateUniqueBadgeTokens(-1, async () => []), /positive integer/);
  await assert.rejects(() => generateUniqueBadgeTokens(1.5, async () => []), /positive integer/);
});
