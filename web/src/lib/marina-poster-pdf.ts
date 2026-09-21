import { PDFDocument, rgb, type PDFFont, type PDFPage, type RGB } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { qrPathData } from "./qr-render.ts";
import { ACTIVE_QR_COLORWAY, QR_SIGNAL_PIXEL_COLOR } from "./qr-colorway.ts";
import { marinaJoinUrl, posterNameSize, type PosterInput } from "./marina-poster.ts";
import { CORMORANT_GARAMOND_600, DM_SANS_500, DM_SANS_700, DM_SANS_800 } from "./poster-fonts/base64.ts";
import { CORMORANT_GARAMOND_ITALIC_300 } from "./badge-fonts/base64.ts";

/**
 * The marina office poster as a PDF, built without a browser.
 *
 * WHY NOT THE HTML BUILDER. marina-poster.ts renders through headless
 * Chrome, which exists on this Mac and not on Vercel — and the admin needs
 * the poster on a phone, in a marina office, not from a terminal. This
 * draws the same poster directly with pdf-lib: no browser, no network, no
 * cold-start Chromium, and the brand faces are embedded by construction
 * rather than fetched from Google Fonts at render time.
 *
 * ONE RENDERER, NOT TWO. `npm run marina-poster` now calls this too, so
 * the button and the batch script produce the same bytes. The badge learnt
 * this the hard way: an SVG renderer and a canvas renderer drew the same
 * artwork until they quietly didn't (see badge-layout.ts).
 *
 * The QR comes from qrPathData — the same matrix, colorway, Level H
 * correction, quiet zone and signal pixel as the badge on the hull.
 *
 * Geometry is in points (72/inch) on US Letter, 612 x 792, mirroring the
 * HTML poster's proportions. Nothing that carries meaning is below 16pt.
 */

const PT = 72;
const PAGE = { w: 8.5 * PT, h: 11 * PT };
const MARGIN_X = 0.65 * PT;
const CONTENT_W = PAGE.w - MARGIN_X * 2;

const NAVY = rgb(0x0d / 255, 0x1f / 255, 0x35 / 255);
const GOLD_PRINT = rgb(0x9a / 255, 0x7a / 255, 0x22 / 255);

function hexRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return rgb(parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255);
}

/** The Unicode the subset in poster-fonts covers. Anything else has no glyph. */
const SUPPORTED = /^[ -~ -ſ–—‘-‚“-„•…€]*$/;

/**
 * Characters a poster cannot print, so a caller can say so plainly instead
 * of handing someone a page with blanks in their marina's name.
 */
export function unprintablePosterChars(text: string): string[] {
  return [...new Set([...text].filter((c) => !SUPPORTED.test(c)))];
}

type Face = { font: PDFFont; size: number; tracking?: number };

function trackedWidth(text: string, { font, size, tracking = 0 }: Face): number {
  return font.widthOfTextAtSize(text, size) + tracking * Math.max(0, text.length - 1);
}

/** pdf-lib has no letter-spacing, and the poster's labels are tracked like the badge's. */
function drawTracked(page: PDFPage, text: string, face: Face, centerX: number, y: number, color: RGB) {
  const { font, size, tracking = 0 } = face;
  let x = centerX - trackedWidth(text, face) / 2;
  for (const ch of text) {
    page.drawText(ch, { x, y, size, font, color });
    x += font.widthOfTextAtSize(ch, size) + tracking;
  }
}

function wrap(text: string, face: Face, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (trackedWidth(candidate, face) <= maxWidth || !line) line = candidate;
    else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Rounded rectangle as an SVG path, in pdf-lib's y-down path space. */
function roundedRect(w: number, h: number, r: number): string {
  return (
    `M${r} 0 H${w - r} A${r} ${r} 0 0 1 ${w} ${r} V${h - r} A${r} ${r} 0 0 1 ${w - r} ${h} ` +
    `H${r} A${r} ${r} 0 0 1 0 ${h - r} V${r} A${r} ${r} 0 0 1 ${r} 0 Z`
  );
}

export async function buildMarinaPosterPdf({ marinaName, city, joinCode }: PosterInput): Promise<Uint8Array> {
  const name = marinaName.trim();
  const bad = unprintablePosterChars(name + (city ?? ""));
  if (bad.length) {
    throw new Error(`The poster can't print ${bad.map((c) => JSON.stringify(c)).join(", ")} — ask Moxie to extend the font subset.`);
  }

  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const embed = (b64: string) => doc.embedFont(Buffer.from(b64, "base64"), { subset: true });
  const [display, dm500, dm700, dm800, wordmark] = await Promise.all([
    embed(CORMORANT_GARAMOND_600),
    embed(DM_SANS_500),
    embed(DM_SANS_700),
    embed(DM_SANS_800),
    embed(CORMORANT_GARAMOND_ITALIC_300),
  ]);

  doc.setTitle(`${name} — Moxie marina code ${formatted(joinCode)}`);
  doc.setProducer("Moxie");
  doc.setCreator("Moxie");
  const page = doc.addPage([PAGE.w, PAGE.h]);

  let y = PAGE.h - 0.5 * PT - 16;

  // "BOAT OWNERS AT"
  drawTracked(page, "BOAT OWNERS AT", { font: dm700, size: 16, tracking: 16 * 0.14 }, PAGE.w / 2, y, NAVY);
  y -= 8;

  // The marina's name, sized by length and wrapped.
  const nameFace = { font: display, size: posterNameSize(name) };
  const nameLines = wrap(name, nameFace, CONTENT_W);
  for (const line of nameLines) {
    y -= nameFace.size * 0.96;
    drawTracked(page, line, nameFace, PAGE.w / 2, y, NAVY);
  }

  if (city?.trim()) {
    y -= 26;
    drawTracked(page, city.trim(), { font: dm500, size: 17 }, PAGE.w / 2, y, NAVY);
  }

  // The ask.
  const askFace = { font: dm700, size: 22 };
  y -= 30;
  for (const line of wrap("Share your boat’s contact details with the marina office", askFace, 6.8 * PT)) {
    drawTracked(page, line, askFace, PAGE.w / 2, y, NAVY);
    y -= 27;
  }

  // QR panel — the badge's own colourway on a navy card.
  const panel = 2.75 * PT;
  const pad = 0.14 * PT;
  const panelX = (PAGE.w - (panel + pad * 2)) / 2;
  y -= panel + pad * 2 - 6;
  page.drawSvgPath(roundedRect(panel + pad * 2, panel + pad * 2, 0.2 * PT), {
    x: panelX,
    y: y + panel + pad * 2,
    color: hexRgb(ACTIVE_QR_COLORWAY.lightModule),
    borderWidth: 0,
  });
  const qr = qrPathData(marinaJoinUrl(joinCode), 2);
  const moduleSize = panel / qr.dim;
  page.drawSvgPath(qr.d, {
    x: panelX + pad,
    y: y + pad + panel,
    scale: moduleSize,
    color: hexRgb(ACTIVE_QR_COLORWAY.darkModule),
    borderWidth: 0,
  });
  page.drawRectangle({
    x: panelX + pad + qr.signal.col * moduleSize,
    y: y + pad + panel - (qr.signal.row + 1) * moduleSize,
    width: moduleSize,
    height: moduleSize,
    color: hexRgb(QR_SIGNAL_PIXEL_COLOR),
  });

  // Scan, or type it.
  y -= 24;
  drawTracked(page, "Scan with your phone camera", { font: dm700, size: 18 }, PAGE.w / 2, y, NAVY);
  y -= 24;
  drawMixed(page, PAGE.w / 2, y, [
    { text: "or go to ", font: dm500, size: 17 },
    { text: "moxieyacht.com/marina/join", font: dm800, size: 17 },
    { text: " and enter", font: dm500, size: 17 },
  ]);

  // The code, the poster's anchor.
  const codeFace = { font: dm800, size: 64, tracking: 64 * 0.06 };
  const code = formatted(joinCode);
  const codeW = trackedWidth(code, codeFace);
  const boxW = codeW + 0.56 * PT;
  const boxH = 64 + 0.18 * PT;
  y -= boxH + 8;
  page.drawSvgPath(roundedRect(boxW, boxH, 0.14 * PT), {
    x: (PAGE.w - boxW) / 2,
    y: y + boxH,
    borderColor: NAVY,
    borderWidth: 4,
  });
  drawTracked(page, code, codeFace, PAGE.w / 2 + (codeFace.tracking ?? 0) / 2, y + 0.16 * PT, NAVY);

  // What it shares, and how to undo it.
  const lineFace = { font: dm500, size: 17 };
  y -= 26;
  const shared = `${name} will see your contact details, emergency contact and slip number — and your registration and insurance, if you choose.`;
  for (const line of wrap(shared, lineFace, 7.1 * PT)) {
    drawTracked(page, line, lineFace, PAGE.w / 2, y, NAVY);
    y -= 22;
  }
  y -= 4;
  for (const line of wrap("You can remove access any time from your vessel page. The marina isn’t notified.", lineFace, 7.1 * PT)) {
    drawTracked(page, line, lineFace, PAGE.w / 2, y, NAVY);
    y -= 22;
  }

  // Wordmark, on the bottom margin.
  drawMixed(page, PAGE.w / 2, 0.42 * PT + 6, [
    { text: "M", font: wordmark, size: 20, color: GOLD_PRINT },
    { text: "oxie", font: wordmark, size: 20 },
  ]);

  return doc.save();
}

function formatted(joinCode: string): string {
  const c = joinCode.toUpperCase().replace(/[\s-]/g, "");
  return `${c.slice(0, 4)}-${c.slice(4)}`;
}

/** One centred line made of runs in different faces (bold URL, gold "M"). */
function drawMixed(page: PDFPage, centerX: number, y: number, runs: { text: string; font: PDFFont; size: number; color?: RGB }[]) {
  const total = runs.reduce((w, r) => w + r.font.widthOfTextAtSize(r.text, r.size), 0);
  let x = centerX - total / 2;
  for (const run of runs) {
    page.drawText(run.text, { x, y, size: run.size, font: run.font, color: run.color ?? NAVY });
    x += run.font.widthOfTextAtSize(run.text, run.size);
  }
}

/**
 * What the batch script used to check by grepping the raw file — which
 * worked only because Chrome left the page tree in plain text. pdf-lib
 * compresses object streams, so the same regexes found nothing at all
 * (pages: 0, fonts: NONE) on a poster that was perfectly fine. Parse it.
 */
export type PosterPdfFacts = { pages: number; width: number; height: number; fonts: string[] };

export async function inspectPosterPdf(bytes: Uint8Array): Promise<PosterPdfFacts> {
  const doc = await PDFDocument.load(bytes);
  const [first] = doc.getPages();
  const { width, height } = first.getSize();
  const fonts = new Set<string>();
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    const match = /\/BaseFont\s*\/([A-Za-z0-9+\-_,]+)/.exec(String(obj));
    if (match) fonts.add(match[1].replace(/^[A-Z]{6}\+/, ""));
  }
  return { pages: doc.getPageCount(), width, height, fonts: [...fonts].sort() };
}
