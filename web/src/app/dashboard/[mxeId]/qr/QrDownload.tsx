"use client";

import { useState } from "react";
import QRCode from "qrcode";

type Props = {
  targetUrl: string;
  mxeId: string;
};

export function QrDownload({ targetUrl, mxeId }: Props) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onDownload() {
    setPending(true);
    setError(null);
    try {
      const dataUrl = await QRCode.toDataURL(targetUrl, {
        width: 1080,
        margin: 2,
      });
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
