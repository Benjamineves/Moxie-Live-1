import sharp from "sharp";
import { buildBadgeSvg } from "./qr-render.ts";
import { BADGE_PRINT_PIXELS } from "./badge-layout.ts";
import { badgeScanUrl } from "./badge-url.ts";

/**
 * Renders one badge to a print-resolution PNG (spec §5.1).
 *
 * SIZING — the trap this function exists to close.
 *
 * The obvious call, `sharp(svg, { density: 600 })`, does NOT produce a
 * 1800px image: density MULTIPLIES the SVG's own width/height, so a
 * size-1800 SVG at density 600 rasterizes to 15000x15000 — a 5 MB file,
 * silently, with no error. That would sail into Storage and only be
 * noticed by whoever opened it. Output dimensions are therefore set
 * explicitly with .resize() and asserted before the buffer is returned,
 * so an oversized PNG cannot reach the bucket even if sharp's defaults
 * change underneath us.
 *
 * The `print` theme is not optional here: rasterized outside a browser,
 * the screen theme's var(--navy) renders BLACK and both fonts fall back
 * to system defaults. See badge-theme.ts.
 */
export const BADGE_ARTWORK_PIXELS = BADGE_PRINT_PIXELS; // 1800 = 3in at 600 DPI

export async function renderBadgeArtworkPng(mxeId: string, token: string): Promise<Buffer> {
  const svg = buildBadgeSvg(mxeId, badgeScanUrl(token), {
    size: BADGE_ARTWORK_PIXELS,
    theme: "print",
  });

  const png = await sharp(Buffer.from(svg))
    .resize(BADGE_ARTWORK_PIXELS, BADGE_ARTWORK_PIXELS, { fit: "fill" })
    .png({ compressionLevel: 9 })
    .toBuffer();

  const meta = await sharp(png).metadata();
  if (meta.width !== BADGE_ARTWORK_PIXELS || meta.height !== BADGE_ARTWORK_PIXELS) {
    throw new Error(
      `Badge artwork for ${mxeId} rasterized to ${meta.width}x${meta.height}, expected ${BADGE_ARTWORK_PIXELS}x${BADGE_ARTWORK_PIXELS}. Refusing to store it.`,
    );
  }

  return png;
}

/**
 * Storage path. Sorted by MXE ID it matches both the order a printed
 * sheet is guillotined and the order the fulfilment queue lists, which
 * is what makes a physical shelf workable. The batch id prefix is an
 * unguessable UUID, but the MXE ID inside it is sequential — that is
 * survivable only because the bucket is private with no policies
 * (20260924). Path obscurity is not the control and must not become it.
 */
export function badgeArtworkPath(printBatchId: string, mxeId: string): string {
  return `${printBatchId}/${mxeId}.png`;
}

export const BADGE_ARTWORK_BUCKET = "badge-artwork";
