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
