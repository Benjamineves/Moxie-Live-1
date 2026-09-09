/**
 * The badge drift guard.
 *
 * Badges are physical and permanent — once one is pressed and stuck to a
 * hull there is no pushing a fix. The failure this file exists to
 * prevent is two renderers quietly disagreeing: that is what produced
 * three copies of the pixel-M mark, and a downloadable PNG missing its
 * "Patent Pending" line. Parameterising buildBadgeSvg by theme removes
 * the opportunity to fork it; these tests are what keep the two branches
 * honest afterwards.
 *
 * The single most important assertion here is that the print theme
 * contains no font reference, no CSS variable and no <text> element at
 * all. That is not a style preference — it is what makes the whole class
 * of font-resolution defect impossible rather than merely fixed. See
 * badge-outline.ts for the measurement that forced it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { buildBadgeSvg } from "./qr-render.ts";
import { PRINT_CARD_FILL, badgeThemeTokens } from "./badge-theme.ts";
import { badgeTextRuns, BADGE_TEXT } from "./badge-layout.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MXE = "MXE-01042";
const URL_ = "https://moxieyacht.com/s/ZNGSEXCBQ";

const screen = buildBadgeSvg(MXE, URL_, { size: 1800, theme: "screen" });
const print = buildBadgeSvg(MXE, URL_, { size: 1800, theme: "print" });

const tagCounts = (svg: string) => {
  const counts: Record<string, number> = {};
  for (const [, tag] of svg.matchAll(/<([a-zA-Z]+)\b/g)) counts[tag] = (counts[tag] ?? 0) + 1;
  return counts;
};

/** Leading \s so `y` does not also match the tail of `font-family="`. */
const attrValues = (svg: string, attr: string) =>
  [...svg.matchAll(new RegExp(`\\s${attr}="([^"]*)"`, "g"))].map((m) => m[1]);

const screenTextNodes = [...screen.matchAll(/<text\b[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]);
const printTextNodes = attrValues(print, "data-badge-text");

test("both themes share one viewBox", () => {
  const of = (svg: string) => svg.match(/viewBox="([^"]+)"/)?.[1];
  assert.equal(of(print), of(screen));
  assert.equal(of(screen), "0 0 1000 1000");
});

test("both themes draw the same words in the same order", () => {
  const expected = ["Moxie", "REGISTERED VESSEL", `SCAN · ${MXE}`, "PATENT PENDING"];
  assert.deepEqual(screenTextNodes, expected);
  assert.deepEqual(printTextNodes, expected);
});

test("caption text is uppercased in the markup, not left to CSS", () => {
  // librsvg ignores text-transform, so a caption left in title case on
  // screen would print in title case too. Uppercasing at the source in
  // badgeTextRuns is what makes all three renderers agree.
  assert.equal(BADGE_TEXT.captionLine1, "Registered Vessel");
  assert.ok(screenTextNodes.includes("REGISTERED VESSEL"));
  assert.ok(printTextNodes.includes("REGISTERED VESSEL"));
});

test("both themes realize every run from the one declaration", () => {
  const runs = badgeTextRuns(MXE, 1000);
  assert.equal(runs.length, 4, "a run was added or dropped without updating this guard");
  assert.deepEqual(screenTextNodes, runs.map((r) => r.text));
  assert.deepEqual(printTextNodes, runs.map((r) => r.text));
});

test("non-text geometry is byte-identical between themes", () => {
  // The rect, the divider and the nested QR <svg> carry these; text
  // positioning is asserted separately because print encodes it inside
  // path data rather than x/y attributes.
  for (const attr of ["width", "height", "rx", "x1", "y1", "x2", "y2", "stroke-width", "viewBox"]) {
    assert.deepEqual(attrValues(print, attr), attrValues(screen, attr), `${attr} differs between themes`);
  }
});

test("the two themes differ only in the card fill and how text is drawn", () => {
  const stripText = (svg: string) => svg.replace(/\s*<(?:text|path)\b[^>]*(?:>[^<]*<\/text>|\/>)/g, "");
  const normalised = stripText(print).split(PRINT_CARD_FILL).join("var(--navy)");
  assert.equal(
    normalised,
    stripText(screen),
    "outside the text runs and the card fill the two themes should be identical — they are not",
  );
});

test("every element count matches except text becoming path", () => {
  const s = tagCounts(screen);
  const p = tagCounts(print);
  assert.equal(s.text, 4, "screen should draw four <text> runs");
  assert.equal(p.path, 4, "print should draw four outlined <path> runs");
  for (const tag of ["svg", "rect", "line"]) {
    assert.equal(p[tag], s[tag], `<${tag}> count differs between themes`);
  }
});

test("the print card fill still matches --navy in globals.css", () => {
  const css = readFileSync(resolve(HERE, "../app/globals.css"), "utf8");
  const navy = css.match(/--navy:\s*([^;]+);/)?.[1]?.trim();
  assert.equal(
    navy,
    PRINT_CARD_FILL,
    "PRINT_CARD_FILL is a hand-copied literal of --navy; globals.css moved and it did not",
  );
});

test("the screen theme is unchanged: still CSS variables", () => {
  assert.ok(screen.includes("var(--navy)"));
  assert.ok(screen.includes("var(--font-display)"));
  assert.ok(screen.includes("var(--font-dm)"));
  assert.ok(!screen.includes("@font-face"), "the browser gets its fonts from next/font, not embedded copies");
});

/**
 * THE ONE THAT MATTERS.
 *
 * Three separate defects reached artwork through font resolution: an
 * unresolved var(--navy) rendering the card black, text-transform being
 * ignored, and @font-face being ignored outright — the last of which
 * printed a whole badge of tofu on Vercel while looking fine on a Mac,
 * because macOS had system fonts to fall back to and the serverless
 * runtime did not.
 *
 * Every one of those is a lookup performed at rasterization time. Print
 * artwork now performs none: no font-family to match, no CSS variable to
 * resolve, no @font-face to load, no <text> to shape. If this assertion
 * ever fails, that guarantee has been given away.
 */
test("print artwork asks the rasterizer to resolve nothing", () => {
  assert.ok(!print.includes("var(--"), "a CSS variable reached print artwork; it will render as a default");
  assert.ok(!print.includes("<text"), "print artwork must draw outlines, never text — fonts do not exist on the render host");
  assert.ok(!print.includes("font-family"), "print artwork must not name a font family");
  assert.ok(!print.includes("@font-face"), "@font-face is inert in librsvg — embedding one gives false confidence");
  assert.ok(!print.includes("text-transform"), "text-transform is inert in librsvg");
});

test("every character in every run produced actual contours", () => {
  // The per-character guard. Each glyph outline opens with at least one
  // moveto — several ('o', 'e', 'P') open two or more — so a run whose
  // moveto count drops below its printable character count has silently
  // drawn nothing for some character. That is precisely how a badge
  // would ship with a letter missing, and it is invisible in markup
  // review because the path attribute is still long and still valid.
  const ds = attrValues(print, "d");
  assert.equal(ds.length, 4, "expected one path per text run");
  const runs = badgeTextRuns(MXE, 1000);
  ds.forEach((d, i) => {
    assert.ok(/^M[-\d]/.test(d), `run ${i} does not start with a moveto`);
    const movetos = (d.match(/M/g) ?? []).length;
    const printable = [...runs[i].text].filter((c) => c !== " ").length;
    assert.ok(
      movetos >= printable,
      `run "${runs[i].text}" produced ${movetos} contours for ${printable} printable characters — a glyph is missing`,
    );
  });
});

test("outlined text is centred, matching text-anchor=middle on screen", () => {
  // Path data is absolute, so the drawn extent can be measured directly
  // and compared to the centre the screen theme anchors to.
  for (const d of attrValues(print, "d")) {
    const xs = [...d.matchAll(/[ML]\s*(-?[\d.]+)\s+(-?[\d.]+)/g)].map((m) => Number(m[1]));
    assert.ok(xs.length > 0, "no absolute coordinates found in path data");
    const centre = (Math.min(...xs) + Math.max(...xs)) / 2;
    assert.ok(
      Math.abs(centre - 500) < 12,
      `outlined run centres on x=${centre.toFixed(1)}, not the badge centre 500 — anchoring drifted`,
    );
  }
});

test("the theme surface is exactly two things", () => {
  // If a third field appears here, the assertion above about the themes
  // being otherwise identical has quietly stopped covering it.
  assert.deepEqual(Object.keys(badgeThemeTokens("print")).sort(), ["cardFill", "renderText"]);
  assert.deepEqual(Object.keys(badgeThemeTokens("screen")).sort(), ["cardFill", "renderText"]);
});
