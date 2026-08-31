/**
 * QR sticker colorway config — a single switch point so changing the
 * active treatment (e.g. if real-world print-and-scan testing shows
 * contrast issues with Navy+Gold) is editing ACTIVE_QR_COLORWAY below,
 * not touching any rendering code.
 *
 * Role assignment verified against the brand guide's own "Navy + Gold
 * (Primary · Hull stickers)" sample (Guide2/Moxie — Brand Guide & Design
 * Reference_files/...original.html, "QR Colorways" section) and the
 * build spec's §15 colorway line — NOT assumed: in that sample, the
 * actual scannable/foreground modules (what a QR library calls the
 * "dark module," i.e. color.dark) are rendered in GOLD, sitting on a
 * NAVY background (the "light module" / quiet-zone). This is the
 * opposite pairing from what "dark modules: navy, light modules: gold"
 * would suggest if read as a literal color name — the brand guide's
 * darkModule/lightModule terminology is about QR-encoding role
 * (foreground vs. background), not the visual darkness of the color
 * chosen to fill that role.
 */
export type QrColorway = {
  name: string;
  /** Color of the actual scannable/foreground modules (qrcode lib's color.dark role). */
  darkModule: string;
  /** Color of the background/quiet-zone (qrcode lib's color.light role). */
  lightModule: string;
};

export const QR_COLORWAY_PRIMARY: QrColorway = {
  name: "Navy + Gold — Primary, hull stickers",
  darkModule: "#c9a84c", // gold
  lightModule: "#071020", // navy-deep
};

export const QR_COLORWAY_FALLBACK: QrColorway = {
  name: "White + Navy — Fallback, if print/scan testing shows contrast issues",
  darkModule: "#071020", // navy-deep
  lightModule: "#ffffff", // white
};

/** Change this one export to switch every QR render (screen, printable view, PNG download) to the fallback colorway. */
export const ACTIVE_QR_COLORWAY: QrColorway = QR_COLORWAY_PRIMARY;

/**
 * Bright Aqua, mirroring the Pixel M wordmark's own signal pixel (see
 * e.g. VesselOwnerProfile.tsx's inline SVG, bottom-right cell). Constant
 * across colorways — a brand-identity marker, not a colorway choice.
 */
export const QR_SIGNAL_PIXEL_COLOR = "#17C3B2";
