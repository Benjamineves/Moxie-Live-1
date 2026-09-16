import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { looksLikeMxeId } from "./mxe-id.ts";

/**
 * `/[mxeId]` is a root-level dynamic segment, so every mistyped
 * single-segment URL in the app reaches it. This shape check is what keeps
 * `/pricng` from being looked up as a vessel, and the tests below also hold
 * the 404 boundaries to what each one can actually know: only the segment
 * where a vessel lookup can fail may talk about vessels, and the app-wide
 * 404 may not talk about them at all.
 */

test("MXE-shaped ids pass the shape check, so the page goes on to look the vessel up", () => {
  for (const v of ["MXE-01024", "MXE-00001", "MXE-99999", "mxe-01024", "Mxe-01024", "  MXE-01024  "]) {
    assert.equal(looksLikeMxeId(v), true, `${JSON.stringify(v)} should read as MXE-shaped`);
  }
});

test("everything else fails the shape check, so the page 404s without a lookup", () => {
  for (const v of [
    "pricng", // the bug: a mistyped marketing path
    "dashboard",
    "login",
    "MXE-1024", // four digits
    "MXE-010244", // six
    "MXE-0102a",
    "MXE01024", // no hyphen
    "MXE-",
    "",
    "   ",
    "MXE-01024/extra",
    "../MXE-01024",
    null,
    undefined,
  ]) {
    assert.equal(looksLikeMxeId(v as string), false, `${JSON.stringify(v)} must not read as MXE-shaped`);
  }
});

test("the vessel page decides the shape through the shared helper", () => {
  const page = readFileSync(new URL("../app/[mxeId]/page.tsx", import.meta.url), "utf8");
  assert.match(page, /looksLikeMxeId/, "page.tsx should decide via the shared helper");
  assert.doesNotMatch(page, /\/\^MXE-/, "page.tsx should not carry its own MXE pattern");
});

test("every 404 boundary renders on the server", () => {
  // The defect this replaced: [mxeId]/not-found.tsx was a client component
  // reading usePathname() to choose between vessel and generic wording.
  // usePathname() returns nothing during the server render of a not-found
  // boundary, so the SSR HTML carried the generic copy and only flipped to
  // the vessel copy after hydration — wrong for curl, crawlers and slow
  // connections, and visibly changing for everyone else.
  for (const p of [
    "../app/not-found.tsx",
    "../app/[mxeId]/not-found.tsx",
    "../app/s/[token]/not-found.tsx",
    "../app/admin/badges/[batchId]/not-found.tsx",
  ]) {
    // Strip comments first: these files explain the defect by name.
    const src = readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
    assert.doesNotMatch(src, /^\s*["']use client["']/m, `${p} must stay a server component`);
    assert.doesNotMatch(src, /usePathname/, `${p} must not depend on usePathname`);
  }
});

test("/dashboard/<mxeId> redirects to the owner view instead of 404ing", () => {
  const src = readFileSync(new URL("../app/dashboard/[mxeId]/page.tsx", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.match(src, /redirect\(/, "it should redirect, not render a second owner view");
  assert.match(src, /\?role=owner/, "to the shape every in-app link already uses");
  assert.match(src, /looksLikeMxeId/, "and 404 a path that is not a vessel code at all");
  // A permanent redirect would be cached indefinitely; this mapping has to
  // stay correctable (same reasoning as /s/<token>, spec §1.7).
  assert.doesNotMatch(src, /permanentRedirect|RedirectType\.replace|308/, "307, not a permanent redirect");
});

test("a badge scan tells a config failure apart from an unknown token", () => {
  const page = readFileSync(new URL("../app/s/[token]/page.tsx", import.meta.url), "utf8");
  const body = page.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // The defect: a missing service role used to 404, telling someone holding
  // a real badge that it did not exist.
  assert.doesNotMatch(body, /if \(!service\) notFound\(\)/, "a missing service role must not 404");
  assert.match(body, /if \(!service\) \{[\s\S]*?throw new Error/, "it must throw, for a 500");
  // And a genuinely unknown token must still 404, not 500.
  assert.match(body, /outcome\.kind === "notFound"\) notFound\(\)/, "an unknown token still 404s");
  // The error boundary exists to carry the distinction.
  const err = readFileSync(new URL("../app/s/[token]/error.tsx", import.meta.url), "utf8");
  const errCopy = err.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(errCopy, /^\s*["']use client["']/m, "error.tsx must be a client component");
  assert.doesNotMatch(errCopy, /not recognised|does not exist|not found/i, "a 500 must not read as a verdict on the badge");
});

test("only the boundaries that know what failed name it", () => {
  const read = (p: string) =>
    readFileSync(new URL(p, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  // The vessel wording is allowed here, where a vessel lookup can genuinely fail.
  assert.match(read("../app/[mxeId]/not-found.tsx"), /vessel/i);
  assert.match(read("../app/s/[token]/not-found.tsx"), /badge/i);
  assert.match(read("../app/admin/badges/[batchId]/not-found.tsx"), /batch/i);
  // ...and nowhere does a boundary claim something it cannot know.
  assert.doesNotMatch(read("../app/s/[token]/not-found.tsx"), /malformed|invalid/i);
});

test("the app-wide 404 never mentions vessels", () => {
  // The whole point: every unmatched URL in the app renders this one.
  const root = readFileSync(new URL("../app/not-found.tsx", import.meta.url), "utf8");
  const copy = root.replace(/\/\*[\s\S]*?\*\//g, ""); // strip the explanatory comment
  assert.doesNotMatch(copy, /vessel/i, "the generic 404 must not name a vessel");
  assert.doesNotMatch(copy, /badge|batch/i, "nor a badge or a batch");
});
