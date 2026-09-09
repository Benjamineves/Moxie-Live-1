/**
 * Guards the sizing trap. `sharp(svg, { density })` MULTIPLIES the SVG's
 * own dimensions rather than setting them, so the obvious call turned a
 * size-1800 badge into a 15000x15000, 5 MB PNG with no error at all.
 * These assert the real output, so such a file cannot reach Storage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";

import { BADGE_ARTWORK_PIXELS, badgeArtworkPath, renderBadgeArtworkPng } from "./badge-artwork.ts";
import { badgeTextRuns } from "./badge-layout.ts";
import { outlineInkExtent } from "./badge-outline.ts";

const CARD_FILL: [number, number, number] = [0x0d, 0x1f, 0x35];

/**
 * Ink coverage inside one horizontal band of the badge — the fraction of
 * pixels that differ from the card fill.
 *
 * Sampling is clamped to the card interior (x 200..1600) because the
 * bottom caption band otherwise reaches into the rounded corners, where
 * the pixels outside the radius are not card fill and would read as ink.
 */
async function bandInk(png: Buffer, top: number, bottom: number) {
  const left = 200;
  const width = 1400;
  const { data, info } = await sharp(png)
    .extract({ left, top, width, height: bottom - top })
    .raw()
    .toBuffer({ resolveWithObject: true });

  let ink = 0;
  let sumX = 0;
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const i = (y * info.width + x) * info.channels;
      const delta =
        Math.abs(data[i] - CARD_FILL[0]) +
        Math.abs(data[i + 1] - CARD_FILL[1]) +
        Math.abs(data[i + 2] - CARD_FILL[2]);
      if (delta > 24) {
        ink += 1;
        sumX += x;
      }
    }
  }
  return {
    coverage: ink / (info.width * info.height),
    centroidX: ink === 0 ? NaN : left + sumX / ink,
  };
}

test("artwork rasterizes to exactly 1800x1800", async () => {
  const png = await renderBadgeArtworkPng("MXE-01042", "ZNGSEXCBQ");
  const meta = await sharp(png).metadata();
  assert.equal(meta.format, "png");
  assert.equal(meta.width, 1800, "3in at 600 DPI is 1800px — anything else is the density trap");
  assert.equal(meta.height, 1800);
  assert.equal(BADGE_ARTWORK_PIXELS, 1800);
});

test("artwork is a plausible size, not a 5MB density accident", async () => {
  const png = await renderBadgeArtworkPng("MXE-01042", "ZNGSEXCBQ");
  assert.ok(png.length > 10_000, `only ${png.length} bytes — did it render at all?`);
  assert.ok(png.length < 1_000_000, `${(png.length / 1024).toFixed(0)} KB is far above the ~120 KB expected`);
});

test("the rendered card is navy, not the black an unresolved var() produces", async () => {
  // The original defect, asserted on actual pixels: with theme "screen"
  // the card rasterized as #000 because librsvg cannot resolve
  // var(--navy). Sampling inside the card (avoiding the rounded corner)
  // is what proves the print theme fixed it.
  const png = await renderBadgeArtworkPng("MXE-01042", "ZNGSEXCBQ");
  const { data } = await sharp(png).extract({ left: 900, top: 60, width: 4, height: 4 }).raw().toBuffer({ resolveWithObject: true });
  const [r, g, b] = [data[0], data[1], data[2]];
  assert.deepEqual([r, g, b], [0x0d, 0x1f, 0x35], `card sampled as rgb(${r},${g},${b}), expected navy #0d1f35`);
});

test("the storage path is batch-scoped and sorts by MXE ID", () => {
  assert.equal(
    badgeArtworkPath("2f8c1e70-0000-4000-8000-000000000001", "MXE-01042"),
    "2f8c1e70-0000-4000-8000-000000000001/MXE-01042.png",
  );
});

/**
 * THE ASSERTION THAT WAS MISSING.
 *
 * The previous pixel test sampled the card fill and passed happily on an
 * image whose every glyph was a tofu box, because it only ever looked at
 * a 4x4 patch of empty navy. A test suite that goes green on unreadable
 * artwork is not testing the thing that matters.
 *
 * This looks where the text actually is. Each run gets a band around its
 * baseline, and the band must contain a believable amount of ink —
 * enough to be text, not so much as to be a row of filled boxes — and it
 * must be centred, because a run drawn at the wrong anchor is as broken
 * as one not drawn at all.
 *
 * The bounds are deliberately wide. This is a smoke detector for "the
 * text did not render, or rendered as something other than text"; it is
 * not a pixel-diff against a golden image, which would break on every
 * librsvg point release without telling us anything true.
 */
test("every text run leaves believable ink where it should", async () => {
  const png = await renderBadgeArtworkPng("MXE-01042", "ZNGSEXCBQ");

  for (const run of badgeTextRuns("MXE-01042", BADGE_ARTWORK_PIXELS)) {
    const top = Math.floor(run.baselineY - run.fontSize * 1.05);
    const bottom = Math.ceil(run.baselineY + run.fontSize * 0.32);
    const { coverage, centroidX } = await bandInk(png, top, bottom);

    assert.ok(
      coverage > 0.005,
      `"${run.text}" band is ${(coverage * 100).toFixed(2)}% ink — the text did not render`,
    );
    assert.ok(
      coverage < 0.35,
      `"${run.text}" band is ${(coverage * 100).toFixed(2)}% ink — far too heavy for text, likely tofu boxes or a filled rect`,
    );
    assert.ok(
      Math.abs(centroidX - BADGE_ARTWORK_PIXELS / 2) < 60,
      `"${run.text}" ink centres on x=${centroidX.toFixed(0)}, not the badge centre — anchoring is wrong`,
    );
  }
});

/**
 * Tofu is uniform: every missing glyph draws the identical box, so the
 * ink repeats on a fixed pitch. Real text does not — letters differ in
 * width and in how much of their column is inked. Measuring the variance
 * of per-column ink separates the two without pinning us to an exact
 * rendering.
 */
test("caption glyphs vary in shape, as letters do and tofu does not", async () => {
  const png = await renderBadgeArtworkPng("MXE-01042", "ZNGSEXCBQ");
  const run = badgeTextRuns("MXE-01042", BADGE_ARTWORK_PIXELS).find((r) => r.key === "captionLine1")!;
  const top = Math.floor(run.baselineY - run.fontSize * 1.05);
  const bottom = Math.ceil(run.baselineY + run.fontSize * 0.32);

  const { data, info } = await sharp(png)
    .extract({ left: 200, top, width: 1400, height: bottom - top })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const columns: number[] = [];
  for (let x = 0; x < info.width; x += 1) {
    let ink = 0;
    for (let y = 0; y < info.height; y += 1) {
      const i = (y * info.width + x) * info.channels;
      const delta =
        Math.abs(data[i] - CARD_FILL[0]) +
        Math.abs(data[i + 1] - CARD_FILL[1]) +
        Math.abs(data[i + 2] - CARD_FILL[2]);
      if (delta > 24) ink += 1;
    }
    columns.push(ink);
  }

  const inked = columns.filter((c) => c > 0);
  assert.ok(inked.length > 50, `only ${inked.length} inked columns — the caption is missing`);

  // A row of identical hollow boxes gives every inked column one of two
  // values (side wall vs top/bottom rule). Letters give a spread.
  const distinct = new Set(inked).size;
  assert.ok(
    distinct > 8,
    `inked columns take only ${distinct} distinct heights — that is a repeating shape, not lettering`,
  );
});

/**
 * Measures how wide the drawn ink actually is, versus how wide the
 * outline says it should be.
 *
 * THIS IS THE ASSERTION THE PIXEL GUARDS WERE MISSING.
 *
 * Coverage, centroid and column variance all went green on six badges
 * whose scan line was truncated mid-caption — because a caption that
 * stops early still has plenty of ink, still varies in column height,
 * and (since the layout centred it for the full string) still has a
 * centroid near enough the middle to pass. What it does NOT have is the
 * right width.
 *
 * The comparison is against outlineInkExtent, not advance width.
 * Advance width includes side bearings and trailing letter-spacing,
 * which mark no pixels, so it needs a different expected ratio per line
 * (0.9837 for the wordmark, 0.9515 for "Patent Pending") and those
 * numbers move whenever badge copy does. Against the outline's own ink
 * extent every correct line measures ~1.0, so one threshold covers all
 * four and survives a copy change.
 *
 * Calibrated on the twenty-five badges that actually shipped: the
 * nineteen correct ones measure 0.9986-1.0004 on every line, and the six
 * corrupted scan lines measure 0.237, 0.539, 0.866, 0.918, 0.931 and
 * 0.932. The threshold sits in that gap with room on both sides.
 */
test("every caption is drawn to its full width, not truncated", async () => {
  const png = await renderBadgeArtworkPng("MXE-01040", "XDGZBSER0");

  for (const run of badgeTextRuns("MXE-01040", BADGE_ARTWORK_PIXELS)) {
    const top = Math.floor(run.baselineY - run.fontSize * 1.05);
    const bottom = Math.ceil(run.baselineY + run.fontSize * 0.32);
    const { data, info } = await sharp(png)
      .extract({ left: 200, top, width: 1400, height: bottom - top })
      .raw()
      .toBuffer({ resolveWithObject: true });

    let minX = Infinity;
    let maxX = -Infinity;
    for (let y = 0; y < info.height; y += 1) {
      for (let x = 0; x < info.width; x += 1) {
        const i = (y * info.width + x) * info.channels;
        const delta =
          Math.abs(data[i] - CARD_FILL[0]) +
          Math.abs(data[i + 1] - CARD_FILL[1]) +
          Math.abs(data[i + 2] - CARD_FILL[2]);
        if (delta > 24) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
    }

    const ratio = (maxX - minX) / outlineInkExtent(run);
    assert.ok(
      Math.abs(ratio - 1) < 0.02,
      `"${run.text}" drew ${(ratio * 100).toFixed(1)}% of its outline's ink width — the caption is truncated or misdrawn`,
    );
  }
});
