"use client";

import { useState } from "react";
import { getQrModules } from "@/lib/qr-render";
import { ACTIVE_QR_COLORWAY, QR_SIGNAL_PIXEL_COLOR } from "@/lib/qr-colorway";
import { BADGE_LAYOUT, BADGE_PRINT_PIXELS, BADGE_TEXT } from "@/lib/badge-layout";

type Props = {
  targetUrl: string;
  mxeId: string;
};

const QR_QUIET_MARGIN = 2; // module-units — same value used in qr-render.ts's badge/QR SVGs

/**
 * next/font's CSS variables (--font-display, --font-dm — see
 * app/layout.tsx) resolve to real font-family names via normal CSS
 * inheritance, but canvas's `font` property has no CSSOM access at all —
 * var() isn't reliably resolved inside a canvas font string across
 * browsers. Reading the computed value off <html> (where the variables
 * are applied) gets the same resolved family name a DOM element would
 * get, without hardcoding it separately from what layout.tsx configures.
 */
function resolveFontFamily(cssVar: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return value || "sans-serif";
}

/**
 * Canvas does not wait for web fonts the way DOM text rendering does —
 * drawing text before a custom font finishes loading silently falls
 * back to a default font instead of erroring, which would be a subtle,
 * easy-to-miss defect on a file headed to a print vendor. Explicitly
 * loading the exact weights/styles used below and awaiting
 * document.fonts.ready guarantees they're rasterizable before fillText
 * runs.
 */
async function ensureFontsReady(displayFamily: string, dmFamily: string): Promise<void> {
  await Promise.all([
    document.fonts.load(`italic 300 100px ${displayFamily}`),
    document.fonts.load(`500 100px ${dmFamily}`),
  ]);
  await document.fonts.ready;
}

/** Manual letter-spacing — canvas's own `ctx.letterSpacing` isn't reliably supported across browsers (notably Safari), and this is a print-bound file where rendering consistency matters more than relying on a patchy platform feature. */
function fillSpacedTextCentered(ctx: CanvasRenderingContext2D, text: string, centerX: number, y: number, letterSpacing: number) {
  const widths = [...text].map((ch) => ctx.measureText(ch).width);
  const totalWidth = widths.reduce((a, b) => a + b, 0) + letterSpacing * (text.length - 1);
  let x = centerX - totalWidth / 2;
  const originalAlign = ctx.textAlign;
  ctx.textAlign = "left";
  for (let i = 0; i < text.length; i++) {
    ctx.fillText(text[i], x, y);
    x += widths[i] + letterSpacing;
  }
  ctx.textAlign = originalAlign;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * The full badge — wordmark, QR (quiet zone fully intact, drawn from
 * the exact same module matrix as buildBadgeSvg/buildQrSvg), gold
 * divider, caption, Patent Pending — rasterized for the downloadable
 * PNG. Print spec (build spec §15 / P1-B acceptance tests, not a
 * default): 3"x3" at 600 DPI = 1800x1800px, see badge-layout.ts.
 *
 * Layout fractions come from the same BADGE_LAYOUT/BADGE_TEXT used by
 * the SVG badge in qr-render.ts — this is the "one shared source" the
 * refactor was for. The QR block is drawn into a fixed square region
 * (qrTopY..qrTopY+qrSize) and every other element is positioned outside
 * that region, so the QR's required blank margin is never encroached on
 * regardless of how the surrounding badge chrome changes later.
 */
async function renderBadgePng(targetUrl: string, mxeId: string): Promise<string> {
  const SIZE = BADGE_PRINT_PIXELS;
  const L = BADGE_LAYOUT;
  const { darkModule, lightModule } = ACTIVE_QR_COLORWAY;

  const displayFamily = resolveFontFamily("--font-display");
  const dmFamily = resolveFontFamily("--font-dm");
  await ensureFontsReady(displayFamily, dmFamily);

  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not available.");

  // Badge background (rounded navy card — the sticker itself).
  roundedRectPath(ctx, 0, 0, SIZE, SIZE, L.cornerRadiusFraction * SIZE);
  ctx.fillStyle = "#0d1f35"; // --navy, matching the SVG badge's fill="var(--navy)"
  ctx.fill();

  // Wordmark.
  ctx.fillStyle = "#ffffff";
  ctx.font = `italic 300 ${L.wordmarkFontSize * SIZE}px ${displayFamily}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(BADGE_TEXT.wordmark, SIZE / 2, L.wordmarkBaselineY * SIZE);

  // QR block, inset within its own square region — quiet zone drawn
  // exactly as in getQrModules/qrFragment, untouched by anything above
  // or below it.
  const { size: moduleCount, isDark, signalRow, signalCol } = getQrModules(targetUrl);
  const qrDim = moduleCount + QR_QUIET_MARGIN * 2;
  const qrPixelSize = L.qrSize * SIZE;
  const qrX = (SIZE - qrPixelSize) / 2;
  const qrY = L.qrTopY * SIZE;
  const moduleScale = qrPixelSize / qrDim;

  ctx.fillStyle = lightModule;
  ctx.fillRect(qrX, qrY, qrPixelSize, qrPixelSize);

  ctx.fillStyle = darkModule;
  for (let row = 0; row < moduleCount; row++) {
    for (let col = 0; col < moduleCount; col++) {
      if (!isDark(row, col)) continue;
      ctx.fillRect(
        qrX + (col + QR_QUIET_MARGIN) * moduleScale,
        qrY + (row + QR_QUIET_MARGIN) * moduleScale,
        moduleScale,
        moduleScale,
      );
    }
  }
  // Signal pixel painted last so it always wins, same reasoning as the SVG badge.
  ctx.fillStyle = QR_SIGNAL_PIXEL_COLOR;
  ctx.fillRect(
    qrX + (signalCol + QR_QUIET_MARGIN) * moduleScale,
    qrY + (signalRow + QR_QUIET_MARGIN) * moduleScale,
    moduleScale,
    moduleScale,
  );

  // Gold divider.
  const marginX = L.contentMarginX * SIZE;
  ctx.strokeStyle = "rgba(201,168,76,0.5)"; // --gold at the same opacity as the SVG badge's divider
  ctx.lineWidth = 0.002 * SIZE;
  ctx.beginPath();
  ctx.moveTo(marginX, L.dividerY * SIZE);
  ctx.lineTo(SIZE - marginX, L.dividerY * SIZE);
  ctx.stroke();

  // Caption + Patent Pending.
  ctx.fillStyle = "rgba(255,255,255,.5)";
  ctx.font = `500 ${L.captionFontSize * SIZE}px ${dmFamily}`;
  fillSpacedTextCentered(ctx, BADGE_TEXT.captionLine1.toUpperCase(), SIZE / 2, L.captionLine1Y * SIZE, 0.02 * SIZE);
  fillSpacedTextCentered(ctx, BADGE_TEXT.scanLabel(mxeId).toUpperCase(), SIZE / 2, L.captionLine2Y * SIZE, 0.02 * SIZE);

  ctx.fillStyle = "rgba(255,255,255,.25)";
  ctx.font = `500 ${L.patentPendingFontSize * SIZE}px ${dmFamily}`;
  fillSpacedTextCentered(ctx, BADGE_TEXT.patentPending.toUpperCase(), SIZE / 2, L.patentPendingY * SIZE, 0.014 * SIZE);

  return canvas.toDataURL("image/png");
}

export function QrDownload({ targetUrl, mxeId }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setPending(true);
    setError(null);
    try {
      const dataUrl = await renderBadgePng(targetUrl, mxeId);
      const anchor = document.createElement("a");
      anchor.href = dataUrl;
      anchor.download = `${mxeId.toLowerCase()}-qr.png`;
      anchor.click();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not generate PNG.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={onDownload}
        disabled={pending}
        className="rounded-lg bg-[var(--aqua-bright)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-50"
      >
        {pending ? "Rendering..." : "Download QR (PNG)"}
      </button>
      {error ? <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p> : null}
    </div>
  );
}
