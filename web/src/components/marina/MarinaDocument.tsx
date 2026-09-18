"use client";

import { useEffect, useState } from "react";
import { vesselDocumentUrl } from "@/lib/document-url";

/**
 * "View" for a document the owner shared with their marina. Same in-app
 * modal as the owner's DocumentViewerModal and ServiceAttachment — a plain
 * link would hand the file to the platform viewer, and standalone mode has
 * no way back (moxie_digital_pwa_spec.md §3b).
 *
 * The bytes come from the owner's documents route, which re-checks marina
 * access on every request (lib/marina-access.ts decideMarinaDocument). A
 * revoked grant stops working at the next view: the service worker never
 * writes this route to its cache, and a marina has no "save for offline".
 *
 * No version token: the marina view carries no upload time, and nothing on
 * a marina's device caches this route for a token to bust.
 */
export function MarinaDocument({
  mxeId,
  docType,
  label,
  format,
}: {
  mxeId: string;
  docType: "registration" | "insurance";
  label: string;
  format: "pdf" | "image";
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[var(--divider)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--gold-deep)] transition hover:bg-[var(--cream)]"
      >
        View
      </button>
      {open ? (
        <MarinaDocumentModal
          href={vesselDocumentUrl(mxeId, docType, null)}
          label={label}
          format={format}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

function MarinaDocumentModal({
  href,
  label,
  format,
  onClose,
}: {
  href: string;
  label: string;
  format: "pdf" | "image";
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${label} — document viewer`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(13,31,53,0.6)] p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--white)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--divider)] px-5 py-4">
          <p className="min-w-0 truncate font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">{label}</p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document viewer"
            className="shrink-0 rounded-md border border-[var(--divider)] px-2.5 py-1.5 font-[family-name:var(--font-dm)] text-sm leading-none text-[var(--text2)] transition hover:bg-[var(--cream)]"
          >
            ✕
          </button>
        </div>

        <div className="flex h-[70vh] items-center justify-center overflow-auto bg-[var(--cream2)]">
          {format === "pdf" ? (
            <iframe src={href} title={label} className="h-full w-full border-0" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={label} className="max-h-full max-w-full object-contain" />
          )}
        </div>

        <div className="border-t border-[var(--divider)] px-5 py-3">
          {/* Same escape hatch as the owner's viewer: iOS Safari renders only
              the first page of an iframed PDF. */}
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline"
          >
            Open full document ↗
          </a>
        </div>
      </div>
    </div>
  );
}
