/**
 * Measures rendered badge artwork against what the outliner intended.
 *
 * Three consecutive artwork defects — tofu glyphs, a silent fallback to
 * the wrong font, and truncated MXE IDs — all reached print review
 * through a green test suite. Each was obvious to a human eye and
 * invisible to the assertions in place at the time. This is the
 * measurement those assertions were missing, factored out so the admin
 * contact sheet and the artwork tests apply exactly the same rule rather
 * than two that can drift apart.
 *
 * WHAT IT COMPARES
 *
 * For each text run, the horizontal extent of ink actually present in
 * the PNG, divided by the extent the outline says that run draws
 * (outlineInkExtent). Correct artwork measures ~1.0 on every line.
 *
 * Deliberately not advance width: that includes side bearings and
 * trailing letter-spacing, which mark no pixels, so it needs a different
 * expected ratio for every line and those numbers move whenever badge
 * copy does. Ink extent gives one threshold that survives a copy change.
 *
 * WHAT IT CATCHES, AND WHAT IT DOES NOT
 *
 * It catches a run that renders short, absent, or grossly misplaced —
 * the truncation class, and anything that stops glyphs reaching the
 * page. It does NOT catch a run of the correct width drawn in the wrong
 * typeface, which is a different measurement; the guard against that is
 * structural, in badge-theme.test.mts, where print artwork is asserted to
 * reference no font at all.
 */
import sharp from "sharp";
import { badgeTextRuns } from "./badge-layout.ts";
import { outlineInkExtent } from "./badge-outline.ts";
import { PRINT_CARD_FILL } from "./badge-theme.ts";
import { BADGE_ARTWORK_PIXELS } from "./badge-artwork.ts";

/**
 * How far from 1.0 a run may measure and still be considered correct.
 *
 * Calibrated on the twenty-five badges of the first minted batch: the
 * nineteen correct ones measure 0.9986-1.0004 on every line, and the six
 * that shipped with a truncated scan line measured 0.237, 0.539, 0.866,
 * 0.918, 0.931 and 0.932. This sits in that gap with room either side —
 * wide enough that anti-aliasing at the ink edges can never trip it,
 * narrow enough that the mildest real truncation seen still fails by a
 * comfortable margin.
 */
export const INK_RATIO_TOLERANCE = 0.02;

/** Card fill as RGB, for telling ink from background. */
const CARD_RGB = [
  parseInt(PRINT_CARD_FILL.slice(1, 3), 16),
  parseInt(PRINT_CARD_FILL.slice(3, 5), 16),
  parseInt(PRINT_CARD_FILL.slice(5, 7), 16),
];

/**
 * Manhattan distance from the card fill past which a pixel counts as
 * ink. The dimmest text on the badge is "Patent Pending" at 25% white
 * over navy, which clears this by a wide margin; JPEG-free PNG noise and
 * anti-aliased edges do not.
 */
const INK_THRESHOLD = 24;

/**
 * Horizontal sampling window. Clamped inside the card because the bottom
 * caption band otherwise reaches into the rounded corners, where pixels
 * outside the radius are not card fill and would read as ink.
 */
const SAMPLE_LEFT = 200;
const SAMPLE_WIDTH = 1400;

export type RunMeasurement = {
  key: string;
  text: string;
  /** Measured ink width ÷ the outline's own ink width. ~1.0 when correct. */
  ratio: number;
  ok: boolean;
};

export type BadgeMeasurement =
  | { ok: true; runs: RunMeasurement[]; worst: RunMeasurement }
  | { ok: false; error: string };

/**
 * Measures one rendered badge. Never throws: a badge that cannot be
 * measured is itself a finding worth showing, and must not take down a
 * review page for the ninety-nine beside it.
 */
export async function measureBadgeArtwork(png: Buffer, mxeId: string): Promise<BadgeMeasurement> {
  try {
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true });

    if (info.width !== BADGE_ARTWORK_PIXELS || info.height !== BADGE_ARTWORK_PIXELS) {
      return { ok: false, error: `Wrong size: ${info.width}×${info.height}` };
    }

    const runs: RunMeasurement[] = badgeTextRuns(mxeId, BADGE_ARTWORK_PIXELS).map((run) => {
      const top = Math.floor(run.baselineY - run.fontSize * 1.05);
      const bottom = Math.ceil(run.baselineY + run.fontSize * 0.32);

      let minX = Infinity;
      let maxX = -Infinity;
      for (let y = top; y < bottom; y += 1) {
        for (let x = SAMPLE_LEFT; x < SAMPLE_LEFT + SAMPLE_WIDTH; x += 1) {
          const i = (y * info.width + x) * info.channels;
          const delta =
            Math.abs(data[i] - CARD_RGB[0]) +
            Math.abs(data[i + 1] - CARD_RGB[1]) +
            Math.abs(data[i + 2] - CARD_RGB[2]);
          if (delta > INK_THRESHOLD) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
          }
        }
      }

      // A run with no ink at all measures 0 rather than NaN — "nothing
      // was drawn" should read as the worst possible result, not as an
      // unmeasurable one that sorts oddly or renders as "NaN".
      const ratio = Number.isFinite(minX) ? (maxX - minX) / outlineInkExtent(run) : 0;
      return {
        key: run.key,
        text: run.text,
        ratio,
        ok: Math.abs(ratio - 1) < INK_RATIO_TOLERANCE,
      };
    });

    // The worst line is what the contact sheet shows: one number per
    // badge, and it is the one most worth knowing.
    const worst = runs.reduce((a, b) => (Math.abs(b.ratio - 1) > Math.abs(a.ratio - 1) ? b : a));
    return { ok: true, runs, worst };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "could not measure" };
  }
}
