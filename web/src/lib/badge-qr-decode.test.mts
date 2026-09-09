/**
 * Reads the QR back out of rendered badge artwork.
 *
 * Every other artwork test asserts something about how the badge was
 * BUILT. This one asserts what a scanner actually gets, by decoding the
 * finished PNG — the only check in the suite that closes the loop from
 * artwork to URL, which is the loop that matters when the thing is glued
 * to a hull and the nearest fix is a reprint.
 *
 * It also pins the property /s/<token> exists to serve: that the badge
 * points at the scan route and carries no ?scan=1 of its own. Dropping
 * that parameter is what buys version 4 density (badge-url.ts), and it
 * would be an easy thing to reintroduce by accident.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import jsQR from "jsqr";

import { renderBadgeArtworkPng, BADGE_ARTWORK_PIXELS } from "./badge-artwork.ts";
import { badgeScanUrl } from "./badge-url.ts";
import { getQrModules } from "./qr-modules.ts";
import { MAX_BADGE_QR_VERSION } from "./qr-modules.ts";

const MXE = "MXE-01023";
const TOKEN = "R8VZ81WQR";

async function decodeAt(png: Buffer, size: number): Promise<string | null> {
  const { data, info } = await sharp(png)
    .resize(size, size, { fit: "fill" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const result = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  return result ? result.data : null;
}

test("rendered artwork decodes back to its own scan URL", async () => {
  const png = await renderBadgeArtworkPng(MXE, TOKEN);
  const decoded = await decodeAt(png, BADGE_ARTWORK_PIXELS);
  assert.equal(decoded, badgeScanUrl(TOKEN));
});

test("the badge stays readable well below print resolution", async () => {
  // 1800px is the print raster. A badge photographed at an angle, or
  // shown on a phone screen, is effectively a downscale of it — so the
  // code has to survive one. 120px is far below anything a 3-inch
  // physical badge presents to a camera; if it decodes there, module
  // size is not the thing that will fail in the field.
  const png = await renderBadgeArtworkPng(MXE, TOKEN);
  for (const size of [600, 300, 180, 120]) {
    assert.equal(
      await decodeAt(png, size),
      badgeScanUrl(TOKEN),
      `artwork stopped decoding at ${size}px`,
    );
  }
});

test("the badge encodes the scan route and no query string", async () => {
  const png = await renderBadgeArtworkPng(MXE, TOKEN);
  const decoded = await decodeAt(png, BADGE_ARTWORK_PIXELS);
  assert.ok(decoded, "nothing decoded");
  assert.match(decoded, /\/s\/[0-9A-HJKMNP-TV-Z]{9}$/, "badge must encode /s/<token> and end there");
  assert.ok(
    !decoded.includes("?"),
    "a query string reached the QR — that is 7 characters of density, and /s/ exists to avoid it",
  );
  assert.ok(!decoded.includes("MXE-"), "the MXE ID must not be encoded; the token resolves it");
});

test("the encoded URL stays inside the print spec's version budget", () => {
  const { version } = getQrModules(badgeScanUrl(TOKEN));
  assert.ok(
    version <= MAX_BADGE_QR_VERSION,
    `encodes at version ${version}, above the version ${MAX_BADGE_QR_VERSION} the badge layout is designed for`,
  );
});
