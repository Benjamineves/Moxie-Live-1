/**
 * The QR module matrix and the badge's version budget.
 *
 * Split out of qr-render.ts for one reason: QrDownload.tsx is a client
 * component and needs getQrModules, while qr-render.ts now reaches
 * badge-theme -> badge-outline -> opentype.js to outline print text.
 * Importing the badge builder from the browser would drag a font parser
 * into a bundle that customers download and never use — the same trap
 * `sharp` set when RenderArtworkButton imported a constant from
 * badge-artwork.ts. Keeping the matrix in its own leaf module makes that
 * structurally impossible rather than a thing to remember.
 */
import QRCode from "qrcode";

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
