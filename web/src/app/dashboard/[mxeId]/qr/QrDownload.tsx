"use client";

import { useState } from "react";
import { getQrModules } from "@/lib/qr-render";
import { ACTIVE_QR_COLORWAY, QR_SIGNAL_PIXEL_COLOR } from "@/lib/qr-colorway";

type Props = {
  targetUrl: string;
  mxeId: string;
};

const MARGIN_MODULES = 2;
const OUTPUT_WIDTH = 1080;

/** Canvas counterpart to lib/qr-render.ts's buildQrSvg — same matrix, same colorway config, rasterized for the PNG download instead of inlined as SVG markup. */
function renderQrPng(targetUrl: string): string {
  const { size, isDark, signalRow, signalCol } = getQrModules(targetUrl);
  const { darkModule, lightModule } = ACTIVE_QR_COLORWAY;
  const dim = size + MARGIN_MODULES * 2;
  const scale = OUTPUT_WIDTH / dim;

  const canvas = document.createElement("canvas");
  canvas.width = OUTPUT_WIDTH;
  canvas.height = OUTPUT_WIDTH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas rendering is not available.");

  ctx.fillStyle = lightModule;
  ctx.fillRect(0, 0, OUTPUT_WIDTH, OUTPUT_WIDTH);

  ctx.fillStyle = darkModule;
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (!isDark(row, col)) continue;
      ctx.fillRect((col + MARGIN_MODULES) * scale, (row + MARGIN_MODULES) * scale, scale, scale);
    }
  }

  // Signal pixel painted last so it always wins regardless of the
  // underlying bit's dark/light state — same reasoning as buildQrSvg.
  ctx.fillStyle = QR_SIGNAL_PIXEL_COLOR;
  ctx.fillRect((signalCol + MARGIN_MODULES) * scale, (signalRow + MARGIN_MODULES) * scale, scale, scale);

  return canvas.toDataURL("image/png");
}

export function QrDownload({ targetUrl, mxeId }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setPending(true);
    setError(null);
    try {
      const dataUrl = renderQrPng(targetUrl);
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
