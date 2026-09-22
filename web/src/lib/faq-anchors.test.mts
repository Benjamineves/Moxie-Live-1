import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * FAQ anchors are an API, not markup. They get linked from support email,
 * in-app nudges and expiry prompts, so renaming one breaks links already
 * sent to people — links nobody can retrofit. These are the ids from
 * docs/design/moxie_faq_page.html, which is the reference copy.
 */
const EXPECTED = [
  "getting-started", "what-is-moxie", "what-is-the-badge", "mxe-number", "badge-or-app", "home-screen",
  "scanning", "what-a-scan-shows", "stranger-documents", "scan-my-own", "how-it-knows", "share-documents",
  "documents", "what-can-i-store", "expiry-status", "offline", "security",
  "ownership", "selling", "buying-badged-boat", "locked-fields", "out-of-service",
  "practical", "cost", "plan-differences", "transfer-fee", "damaged-badge", "outside-california",
];

const faq = readFileSync(new URL("../components/marketing/MoxieFaq.tsx", import.meta.url), "utf8");
const mockup = readFileSync(new URL("../../../docs/design/moxie_faq_page.html", import.meta.url), "utf8");

test("every anchor in the reference mockup exists on the built page", () => {
  const inMockup = [...mockup.matchAll(/id="([a-z-]+)"/g)].map((m) => m[1]);
  for (const id of inMockup) {
    assert.ok(faq.includes(`"${id}"`), `mockup anchor #${id} is missing from the page`);
  }
});

test("the published anchor list matches the page, in order", () => {
  const declared = [...faq.matchAll(/^\s{2}"([a-z-]+)",$/gm)].map((m) => m[1]);
  assert.deepEqual(declared, EXPECTED, "FAQ_ANCHORS drifted from the settled set");
  for (const id of EXPECTED) assert.ok(faq.includes(`id="${id}"`), `#${id} is declared but not rendered`);
});

test("the expiry answer promises no reminder until something sends one", () => {
  // CLAUDE.md: copy never promises what doesn't send. The expiry reminder
  // has a template and no sender until the scheduler's reminder step is on.
  const answer = faq.slice(faq.indexOf('id="expiry-status"'), faq.indexOf('id="offline"'));
  assert.doesNotMatch(answer, /remind|notify|alert|we'?ll email|email you/i);
});

test("nothing on the page claims unlimited documents", () => {
  const copy = faq.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(copy, /unlimited/i, "neither plan has unlimited documents");
});

test("the transfer answer may name the service history — it ships", () => {
  // This test used to forbid the words outright, from when service records
  // were unbuilt. They shipped 2026-09-16 (migration 20261005 is run), and
  // #selling now describes what the transfer actually carries. What must
  // stay true is the shape of the promise: entries carry, files don't.
  const answer = faq.slice(faq.indexOf('id="selling"'), faq.indexOf('id="buying-badged-boat"'));
  if (/service history/i.test(answer)) {
    assert.match(answer, /without the attached files|not the attached files/i, "entries carry; the files do not");
  }
});

test("links use the light-surface gold, never --gold", () => {
  // Brand addendum §6b: --gold is 2.05:1 on cream. This page is all light.
  assert.doesNotMatch(faq, /text-\[var\(--gold\)\]/, "use --gold-deep on a light surface");
  assert.match(faq, /text-\[var\(--gold-deep\)\]/);
});

test("the reference mockup is kept, without the review notes leaking into the page", () => {
  assert.match(mockup, /Review notes — not for the live page/, "the mockup is stored verbatim");
  assert.doesNotMatch(faq, /Review notes/, "the review block must not ship");
});
