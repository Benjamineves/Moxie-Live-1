/**
 * Single source of truth for the Moxie hull-sticker "badge" — wordmark,
 * QR code, gold divider, caption, Patent Pending line. Both renderers
 * (buildBadgeSvg in qr-render.ts, used on-screen and for the print view;
 * the canvas builder in QrDownload.tsx, used for the downloadable PNG)
 * read the same text and proportions from here. That's the direct fix
 * for how the PNG ended up missing Patent Pending after the SVG version
 * got it: three independent implementations meant one could silently
 * drift from the others. Now there's one place that decides what the
 * badge says and how it's proportioned; the two renderers only differ in
 * the unavoidable mechanics of SVG markup vs. canvas pixel drawing.
 */

/**
 * Print spec — documented, not a default. build spec §15 ("Printable
 * sticker composition") and the P1-B acceptance tests both call for
 * 3"x3" at 600 DPI minimum. Used as-is, not picked.
 */
export const BADGE_PRINT_DPI = 600;
export const BADGE_PRINT_INCHES = 3;
export const BADGE_PRINT_PIXELS = BADGE_PRINT_DPI * BADGE_PRINT_INCHES; // 1800

export const BADGE_TEXT = {
  wordmark: "Moxie",
  captionLine1: "Registered Vessel",
  scanLabel: (mxeId: string) => `Scan · ${mxeId}`,
  patentPending: "Patent Pending",
};

/**
 * Proportional layout, expressed as fractions of the overall badge size
 * (the badge is always square) so the same numbers describe a
 * consistent composition whether rendered at on-screen preview size or
 * full 1800px print resolution — no separate pixel values to keep in
 * sync per renderer.
 *
 * The QR block's own quiet zone (drawn inside getQrModules/buildQrSvg,
 * unchanged by this file) sits entirely within qrTopY..qrTopY+qrSize.
 * Every other element (wordmark, divider, captions, Patent Pending) is
 * positioned outside that range — never overlapping the QR block — so
 * the required blank margin around the modules stays fully intact
 * regardless of how the surrounding badge chrome changes.
 */
export const BADGE_LAYOUT = {
  contentMarginX: 0.1,
  cornerRadiusFraction: 0.05, // proportional, not the build spec's literal "10-14px" — see qr-render.ts note
  wordmarkFontSize: 0.075,
  wordmarkBaselineY: 0.135,
  qrTopY: 0.19,
  qrSize: 0.62,
  dividerY: 0.845,
  captionLine1Y: 0.885,
  captionFontSize: 0.026,
  captionLine2Y: 0.915,
  patentPendingY: 0.955,
  patentPendingFontSize: 0.018,
} as const;

/**
 * The two faces the badge draws. A face implies its style and weight —
 * `display` is Cormorant Garamond italic 300, `dm` is DM Sans 500 — so
 * face-to-font is one mapping rather than a family/style/weight triple
 * that two renderers could assemble differently.
 */
export type BadgeFace = "display" | "dm";

/**
 * Every piece of text on the badge, declared once with its geometry.
 *
 * This exists so the screen and print themes cannot disagree about
 * *what* is drawn or *where*, only about *how*. Screen turns each run
 * into a <text> element; print turns the identical run into a path
 * outline (badge-outline.ts). Both consume this list, so a run added,
 * moved or reworded changes both at once — there is no second place to
 * update and forget.
 *
 * Captions are uppercased HERE rather than by CSS text-transform.
 * librsvg does not apply text-transform, so the print rasterization
 * silently rendered mixed case where the screen rendered caps — a
 * divergence QrDownload.tsx had already worked around with its own
 * .toUpperCase(). Doing it at the source makes all three renderers agree.
 *
 * `unit` is the coordinate space the caller is drawing in (1000 for
 * buildBadgeSvg's viewBox); every fraction above is resolved against it
 * so callers receive absolute numbers and do no arithmetic of their own.
 */
export function badgeTextRuns(
  mxeId: string,
  unit: number,
): Array<{
  key: string;
  text: string;
  face: BadgeFace;
  centerX: number;
  baselineY: number;
  fontSize: number;
  letterSpacing: number;
  fill: string;
}> {
  const L = BADGE_LAYOUT;
  const centerX = unit / 2;
  const captionFill = "rgba(255,255,255,.5)";

  return [
    {
      key: "wordmark",
      text: BADGE_TEXT.wordmark,
      face: "display",
      centerX,
      baselineY: L.wordmarkBaselineY * unit,
      fontSize: L.wordmarkFontSize * unit,
      letterSpacing: 0,
      fill: "white",
    },
    {
      key: "captionLine1",
      text: BADGE_TEXT.captionLine1.toUpperCase(),
      face: "dm",
      centerX,
      baselineY: L.captionLine1Y * unit,
      fontSize: L.captionFontSize * unit,
      letterSpacing: 0.02 * unit,
      fill: captionFill,
    },
    {
      key: "scanLabel",
      text: BADGE_TEXT.scanLabel(mxeId).toUpperCase(),
      face: "dm",
      centerX,
      baselineY: L.captionLine2Y * unit,
      fontSize: L.captionFontSize * unit,
      letterSpacing: 0.02 * unit,
      fill: captionFill,
    },
    {
      key: "patentPending",
      text: BADGE_TEXT.patentPending.toUpperCase(),
      face: "dm",
      centerX,
      baselineY: L.patentPendingY * unit,
      fontSize: L.patentPendingFontSize * unit,
      letterSpacing: 0.014 * unit,
      fill: "rgba(255,255,255,.25)",
    },
  ];
}
