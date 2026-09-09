import { ACTIVE_QR_COLORWAY, QR_SIGNAL_PIXEL_COLOR } from "./qr-colorway.ts";
import { getQrModules, MAX_BADGE_QR_VERSION, assertBadgeQrVersionWithinBudget } from "./qr-modules.ts";

// Re-exported so existing server-side importers keep their import site.
// Client components must import from ./qr-modules directly — see the
// header there.
export { getQrModules, MAX_BADGE_QR_VERSION, assertBadgeQrVersionWithinBudget };
import { BADGE_LAYOUT, badgeTextRuns } from "./badge-layout.ts";
import { badgeThemeTokens, type BadgeTheme } from "./badge-theme.ts";

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
export function buildBadgeSvg(
  mxeId: string,
  targetUrl: string,
  { size, theme = "screen" }: { size: number; theme?: BadgeTheme },
): string {
  const UNIT = 1000; // internal coordinate space; `size` only controls on-screen display size via width/height
  const { darkModule } = ACTIVE_QR_COLORWAY;
  const L = BADGE_LAYOUT;
  const T = badgeThemeTokens(theme);

  const { dim: qrDim, markup: qrMarkup } = qrFragment(targetUrl, QR_QUIET_MARGIN);
  const qrPixelSize = L.qrSize * UNIT;
  const qrX = (UNIT - qrPixelSize) / 2;
  const qrY = L.qrTopY * UNIT;

  const marginX = L.contentMarginX * UNIT;
  const cornerR = L.cornerRadiusFraction * UNIT;

  // Every text run is declared once in badge-layout.ts and realized here
  // by the theme — <text> for screen, an outlined <path> for print. The
  // wordmark is drawn above the QR block and the three caption lines
  // below it, which is why the list is split around the QR rather than
  // emitted in one go.
  const runs = badgeTextRuns(mxeId, UNIT);
  const wordmark = runs.find((run) => run.key === "wordmark");
  if (!wordmark) throw new Error("badgeTextRuns lost the wordmark run.");
  const captions = runs.filter((run) => run.key !== "wordmark");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${UNIT} ${UNIT}" width="${size}" height="${size}">
    <rect width="${UNIT}" height="${UNIT}" rx="${cornerR}" fill="${T.cardFill}"/>
    ${T.renderText(wordmark)}
    <svg x="${qrX}" y="${qrY}" width="${qrPixelSize}" height="${qrPixelSize}" viewBox="0 0 ${qrDim} ${qrDim}" shape-rendering="crispEdges">${qrMarkup}</svg>
    <line x1="${marginX}" y1="${L.dividerY * UNIT}" x2="${UNIT - marginX}" y2="${L.dividerY * UNIT}" stroke="${darkModule}" stroke-opacity="0.5" stroke-width="${0.002 * UNIT}"/>
    ${captions.map((run) => T.renderText(run)).join("\n    ")}
  </svg>`;
}
