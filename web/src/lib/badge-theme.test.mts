/**
 * The drift guard.
 *
 * This repo has twice shipped two renderers of the same artwork that
 * quietly disagreed — three copies of the pixel-M mark, and a
 * downloadable PNG that lost its "Patent Pending" line. Parameterising
 * buildBadgeSvg by theme removes the opportunity to fork it; these tests
 * are what make that structural rather than a matter of discipline.
 *
 * The contract: both themes produce IDENTICAL geometry and IDENTICAL
 * text, differing only in fill values and font references.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildBadgeSvg } from "./qr-render.ts";
import { PRINT_CARD_FILL, badgeThemeTokens } from "./badge-theme.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MXE = "MXE-01042";
const URL_ = "https://moxieyacht.com/s/ZNGSEXCBQ";

const screen = buildBadgeSvg(MXE, URL_, { size: 1800, theme: "screen" });
const print = buildBadgeSvg(MXE, URL_, { size: 1800, theme: "print" });

/** Strip the print theme's <defs> so structural comparisons see the badge itself. */
const withoutDefs = (svg: string) => svg.replace(/<defs>[\s\S]*?<\/defs>/, "");

const tagCounts = (svg: string) => {
  const counts = new Map<string, number>();
  for (const m of svg.matchAll(/<([a-z]+)[\s/>]/g)) counts.set(m[1], (counts.get(m[1]) ?? 0) + 1);
  return counts;
};
const textNodes = (svg: string) => [...svg.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
// The leading \s matters: without it, attr "y" also matches the tail of
// font-family=" and the comparison reports a geometry difference that is
// really the intended font substitution.
const attrValues = (svg: string, attr: string) =>
  [...svg.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, "g"))].map((m) => m[1]);

test("both themes share one viewBox", () => {
  const vb = (svg: string) => /viewBox="([^"]+)"/.exec(svg)?.[1];
  assert.equal(vb(screen), "0 0 1000 1000");
  assert.equal(vb(print), vb(screen));
});

test("both themes emit identical element counts", () => {
  const a = tagCounts(withoutDefs(screen));
  const b = tagCounts(withoutDefs(print));
  assert.deepEqual([...b.entries()].sort(), [...a.entries()].sort(),
    "the two themes no longer draw the same elements — one of them has been forked");
});

test("both themes emit identical text content", () => {
  const a = textNodes(screen);
  const b = textNodes(print);
  assert.deepEqual(b, a);
  // And the actual strings, so a silent loss like the missing
  // "Patent Pending" fails here rather than in someone's hands.
  assert.deepEqual(a, ["Moxie", "REGISTERED VESSEL", `SCAN · ${MXE}`, "PATENT PENDING"]);
});

test("caption text is uppercased in the markup, not left to CSS", () => {
  // librsvg ignores text-transform, so relying on CSS meant the printed
  // badge said "Registered Vessel" while the screen said "REGISTERED
  // VESSEL". Both themes must carry caps in the markup itself.
  for (const svg of [screen, print]) {
    assert.ok(svg.includes(">REGISTERED VESSEL<"), "caption line 1 is not uppercase in the markup");
    assert.ok(svg.includes(">PATENT PENDING<"), "patent pending is not uppercase in the markup");
  }
});

test("geometry attributes are byte-identical between themes", () => {
  for (const attr of ["x", "y", "width", "height", "rx", "x1", "y1", "x2", "y2", "font-size", "letter-spacing", "stroke-width"]) {
    assert.deepEqual(attrValues(print, attr), attrValues(screen, attr), `${attr} differs between themes`);
  }
});

test("the ONLY differences are the card fill and the two font families", () => {
  // Normalise the known-permitted substitutions; anything left over is
  // an unintended divergence.
  const T = badgeThemeTokens("print");
  const normalised = print
    .replace(/<defs>[\s\S]*?<\/defs>/, "")
    .split(T.cardFill).join("var(--navy)")
    .split(T.displayFamily).join("var(--font-display)")
    .split(T.dmFamily).join("var(--font-dm)");

  assert.equal(normalised, screen,
    "after substituting fills and fonts the two themes should be identical — they are not");
});

test("the print card fill still matches --navy in globals.css", () => {
  // The one literal a server-side rasterizer cannot look up for itself.
  // If globals.css moves, this fails rather than printing the old colour.
  const css = readFileSync(resolve(HERE, "../app/globals.css"), "utf8");
  const navy = /--navy:\s*(#[0-9a-fA-F]{6})/.exec(css)?.[1];
  assert.ok(navy, "could not find --navy in globals.css");
  assert.equal(PRINT_CARD_FILL.toLowerCase(), navy.toLowerCase());
});

test("the screen theme is unchanged: still CSS variables, no embedded fonts", () => {
  assert.ok(screen.includes('fill="var(--navy)"'));
  assert.ok(screen.includes('font-family="var(--font-display)"'));
  assert.ok(screen.includes('font-family="var(--font-dm)"'));
  assert.ok(!screen.includes("<defs>"), "the screen theme must not carry embedded fonts");
  assert.ok(!screen.includes("base64"), "the screen theme must not carry embedded fonts");
});

test("the print theme resolves everything a rasterizer cannot", () => {
  assert.ok(!withoutDefs(print).includes("var(--"), "print theme still contains an unresolved CSS variable");
  assert.ok(print.includes("@font-face"), "print theme is missing its embedded faces");
  assert.ok(print.includes("Cormorant Garamond") && print.includes("DM Sans"));
});

test("both embedded faces are real WOFF2 payloads", () => {
  // Guards against an empty or truncated base64 regeneration, which
  // would fall back to a system font as silently as no embed at all.
  const faces = [...print.matchAll(/base64,([A-Za-z0-9+/=]+)\)/g)].map((m) => m[1]);
  assert.equal(faces.length, 2, `expected 2 embedded faces, found ${faces.length}`);
  for (const b64 of faces) {
    const buf = Buffer.from(b64, "base64");
    assert.ok(buf.length > 1000, `embedded face is only ${buf.length} bytes`);
    assert.equal(buf.subarray(0, 4).toString("latin1"), "wOF2", "embedded face is not WOFF2");
  }
});
