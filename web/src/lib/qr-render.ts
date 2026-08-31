import QRCode from "qrcode";
import { ACTIVE_QR_COLORWAY, QR_SIGNAL_PIXEL_COLOR } from "./qr-colorway";

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
    isDark: (row: number, col: number) => qr.modules.get(row, col) === 1,
    signalRow: size - 1,
    signalCol: size - 1,
  };
}

/**
 * Hand-built SVG (server-safe, no canvas) for the on-screen/printable
 * views in qr/page.tsx. The signal pixel is drawn unconditionally,
 * regardless of that module's actual encoded bit — same reasoning as
 * the build spec's original note: it's absorbed by Level H's ~30%
 * damage tolerance exactly like a scuff or worn corner would be, not a
 * bit the decoder is relying on.
 */
export function buildQrSvg(text: string, { width, margin }: { width: number; margin: number }): string {
  const { size, isDark, signalRow, signalCol } = getQrModules(text);
  const { darkModule, lightModule } = ACTIVE_QR_COLORWAY;
  const dim = size + margin * 2;

  let cells = "";
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue;
      const x = col + margin;
      const y = row + margin;
      cells += `<rect x="${x}" y="${y}" width="1" height="1" fill="${darkModule}"/>`;
    }
  }
  // Signal pixel painted last so it always wins regardless of the
  // underlying bit's dark/light state.
  cells += `<rect x="${signalCol + margin}" y="${signalRow + margin}" width="1" height="1" fill="${QR_SIGNAL_PIXEL_COLOR}"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${width}" height="${width}" shape-rendering="crispEdges"><rect width="${dim}" height="${dim}" fill="${lightModule}"/>${cells}</svg>`;
}
