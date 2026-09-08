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
