import QRCode from "qrcode";
import { ACTIVE_QR_COLORWAY, QR_SIGNAL_PIXEL_COLOR } from "./qr-colorway";
import { BADGE_LAYOUT, BADGE_TEXT } from "./badge-layout";

/**
 * qrcode's own toString/toDataURL only support a uniform two-color
 * scheme (color.dark/color.light) — there's no per-module override in
 * its public API, so a single recolored signal pixel needs the raw
 * module matrix (create()) instead, rendered by hand. Finder-pattern
 * corners need no special-casing: they're ordinary "on" modules in the
 * matrix, so they inherit ACTIVE_QR_COLORWAY.darkModule the same as
 * every other data module — this is a color change, not a logic change.
 *
 * Error correction is explicitly Level H here — the current code being
 * replaced never actually set errorCorrectionLevel (silently defaulting
 * to qrcode's 'M'), contrary to the build spec's own §15 ("Level H...
 * non-negotiable"). Fixing that as part of this change, not leaving it
 * as a silent gap.
 */
export function getQrModules(text: string) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const size = qr.modules.size;
  return {
    size,
    version: qr.version,
    isDark: (row: number, col: number) => qr.modules.get(row, col) === 1,
    signalRow: size - 1,
    signalCol: size - 1,
  };
}

/**
 * The badge print spec is measured against a version 5 (37x37 module)
 * grid — 3in badge, 62% QR block, 41 units including the quiet zone,
 * ~1.15mm modules (see docs/moxie_digital_acceptance_tests.md's
 * QR-generation section for the full math). A version bump densifies
 * every printed badge without anyone deciding that on purpose, and
 * badges are physical and permanent — there's no "push a fix" once one
 * is printed and stuck to a hull. This is the one place that constraint
 * can actually be enforced, since it's the one place the final encoded
 * URL (base URL + mxeId + params) is assembled.
 */
export const MAX_BADGE_QR_VERSION = 5;

export function assertBadgeQrVersionWithinBudget(text: string): void {
  const { version } = getQrModules(text);
  if (version > MAX_BADGE_QR_VERSION) {
    throw new Error(
      `Badge QR for "${text}" encodes at version ${version}, exceeding the version ${MAX_BADGE_QR_VERSION} the badge print spec is designed for (docs/moxie_digital_acceptance_tests.md). This must be resolved deliberately — shorten the encoded URL, or re-derive the badge layout for a denser code — not shipped silently.`,
    );
  }
}

/**
 * Just the module cells + background, no outer <svg> wrapper — shared by
 * buildQrSvg (a standalone bare QR) and buildBadgeSvg (the same cells
 * embedded as a nested <svg> at a specific position within the full
 * badge composition). The signal pixel is drawn unconditionally,
 * regardless of that module's actual encoded bit — same reasoning as
 * the build spec's original note: it's absorbed by Level H's ~30%
 * damage tolerance exactly like a scuff or worn corner would be, not a
 * bit the decoder is relying on.
 */
function qrFragment(text: string, margin: number): { dim: number; markup: string } {
  const { size, isDark, signalRow, signalCol } = getQrModules(text);
  const { darkModule, lightModule } = ACTIVE_QR_COLORWAY;
  const dim = size + margin * 2;

  let cells = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue;
      cells += `<rect x="${col + margin}" y="${row + margin}" width="1" height="1" fill="${darkModule}"/>`;
    }
  }
  cells += `<rect x="${signalCol + margin}" y="${signalRow + margin}" width="1" height="1" fill="${QR_SIGNAL_PIXEL_COLOR}"/>`;

  return { dim, markup: `<rect width="${dim}" height="${dim}" fill="${lightModule}"/>${cells}` };
}

/** Hand-built SVG (server-safe, no canvas) for a bare QR code — no badge chrome. */
export function buildQrSvg(text: string, { width, margin }: { width: number; margin: number }): string {
  const { dim, markup } = qrFragment(text, margin);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${width}" height="${width}" shape-rendering="crispEdges">${markup}</svg>`;
}

const QR_QUIET_MARGIN = 2; // module-units — same value used everywhere the QR block is embedded

/**
 * Full badge — wordmark, QR (with its quiet zone fully intact, drawn by
 * qrFragment/buildQrSvg's exact same logic, untouched), gold divider,
 * caption, Patent Pending. Layout comes entirely from badge-layout.ts;
 * this function only turns those fractions into SVG markup. Used for
 * both the on-screen and printable views in qr/page.tsx — one
 * implementation, not two, for the piece that used to differ between
 * them (this is also why the PNG counterpart, QrDownload.tsx, only
 * shares the *layout numbers* rather than this markup directly: canvas
 * pixel-drawing and SVG-string-building are different enough mechanics
 * that only the underlying qrcode matrix and layout fractions could be
 * shared, not the rendering code itself).
 */
export function buildBadgeSvg(mxeId: string, targetUrl: string, { size }: { size: number }): string {
  const UNIT = 1000; // internal coordinate space; `size` only controls on-screen display size via width/height
  const { darkModule } = ACTIVE_QR_COLORWAY;
  const L = BADGE_LAYOUT;

  const { dim: qrDim, markup: qrMarkup } = qrFragment(targetUrl, QR_QUIET_MARGIN);
  const qrPixelSize = L.qrSize * UNIT;
  const qrX = (UNIT - qrPixelSize) / 2;
  const qrY = L.qrTopY * UNIT;

  const marginX = L.contentMarginX * UNIT;
  const cornerR = L.cornerRadiusFraction * UNIT;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNIT} ${UNIT}" width="${size}" height="${size}">
    <rect width="${UNIT}" height="${UNIT}" rx="${cornerR}" fill="var(--navy)"/>
    <text x="${UNIT / 2}" y="${L.wordmarkBaselineY * UNIT}" text-anchor="middle" font-family="var(--font-display)" font-style="italic" font-weight="300" font-size="${L.wordmarkFontSize * UNIT}" fill="white">${BADGE_TEXT.wordmark}</text>
    <svg x="${qrX}" y="${qrY}" width="${qrPixelSize}" height="${qrPixelSize}" viewBox="0 0 ${qrDim} ${qrDim}" shape-rendering="crispEdges">${qrMarkup}</svg>
    <line x1="${marginX}" y1="${L.dividerY * UNIT}" x2="${UNIT - marginX}" y2="${L.dividerY * UNIT}" stroke="${darkModule}" stroke-opacity="0.5" stroke-width="${0.002 * UNIT}"/>
    <text x="${UNIT / 2}" y="${L.captionLine1Y * UNIT}" text-anchor="middle" font-family="var(--font-dm)" font-weight="500" font-size="${L.captionFontSize * UNIT}" letter-spacing="${0.02 * UNIT}" fill="rgba(255,255,255,.5)" style="text-transform:uppercase">${BADGE_TEXT.captionLine1}</text>
    <text x="${UNIT / 2}" y="${L.captionLine2Y * UNIT}" text-anchor="middle" font-family="var(--font-dm)" font-weight="500" font-size="${L.captionFontSize * UNIT}" letter-spacing="${0.02 * UNIT}" fill="rgba(255,255,255,.5)" style="text-transform:uppercase">${BADGE_TEXT.scanLabel(mxeId)}</text>
    <text x="${UNIT / 2}" y="${L.patentPendingY * UNIT}" text-anchor="middle" font-family="var(--font-dm)" font-weight="500" font-size="${L.patentPendingFontSize * UNIT}" letter-spacing="${0.014 * UNIT}" fill="rgba(255,255,255,.25)" style="text-transform:uppercase">${BADGE_TEXT.patentPending}</text>
  </svg>`;
}
