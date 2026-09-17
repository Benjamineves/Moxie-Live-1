"use client";

import { useEffect, useState } from "react";
import { serviceRecordFileUrl } from "@/lib/document-url";
import type { ServiceRecord } from "@/lib/service-records";

/**
 * The owner's view of a service record's attachment — the control
 * ServiceHistory's comment promised and nobody had built. Until this
 * existed, an upload stored a path and a name and the bytes were
 * unreachable by anyone, the owner included.
 *
 * OWNER-ONLY BY CONSTRUCTION. This lives on the owner's own page and is
 * passed to ServiceHistory as a render prop; ServiceHistory itself still
 * takes no file path and has no idea this exists, so the shared view and
 * the post-transfer view are unchanged. That is the same separation
 * withoutFilePaths enforces in the store: two independent reasons a
 * reader cannot reach a file, rather than one flag to get wrong.
 *
 * AFTER A TRANSFER the buyer's row has file_path NULL and
 * file_was_attached true. There is nothing to open, so this renders the
 * note instead of a link that would 404 — the attachment stayed with the
 * seller and is theirs to share.
 *
 * Modelled on DocumentViewerModal (vessel-edit/DocumentsEdit.tsx): an
 * in-app modal rather than a plain link, because handing a file to the
 * platform viewer leaves the app and standalone mode has no way back
 * (moxie_digital_pwa_spec.md §3b). No offline branch — service records
 * are not part of the save-for-offline flow.
 */

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(nameOrPath: string) {
  return nameOrPath.toLowerCase().endsWith(".pdf");
}

const meta = "font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]";

export function ServiceAttachment({ mxeId, record }: { mxeId: string; record: ServiceRecord }) {
  const [open, setOpen] = useState(false);

  // Detached at transfer: the entry remembers it had evidence, but the
  // bytes are not ours to serve.
  if (!record.file_path) {
    if (!record.file_was_attached) return null;
    return <p className={meta}>Document held by the previous owner — ask them for it directly.</p>;
  }

  const name = record.file_name ?? "Attachment";
  const size = typeof record.file_size_bytes === "number" ? formatBytes(record.file_size_bytes) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="font-[family-name:var(--font-dm)] text-[11px] font-medium text-[var(--gold-deep)] underline underline-offset-2"
      >
        {name}
        {size ? <span className="font-normal text-[var(--text3)]"> · {size}</span> : null}
      </button>
      {open ? (
        <AttachmentModal mxeId={mxeId} record={record} name={name} size={size} onClose={() => setOpen(false)} />
      ) : null}
    </>
  );
}

function AttachmentModal({
  mxeId,
  record,
  name,
  size,
  onClose,
}: {
  mxeId: string;
  record: ServiceRecord;
  name: string;
  size: string | null;
  onClose: () => void;
}) {
  const href = serviceRecordFileUrl(mxeId, record.id, record.updated_at);

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
      aria-label={`${name} — attachment viewer`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(13,31,53,0.6)] p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--white)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--divider)] px-5 py-4">
          <div className="min-w-0">
            <p className="truncate font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">{name}</p>
            <p className={`mt-0.5 truncate ${meta}`}>
              {[record.service_date.slice(0, 10), size].filter(Boolean).join(" · ")}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close attachment viewer"
            className="shrink-0 rounded-md border border-[var(--divider)] px-2.5 py-1.5 font-[family-name:var(--font-dm)] text-sm leading-none text-[var(--text2)] transition hover:bg-[var(--cream)]"
          >
            ✕
          </button>
        </div>

        <div className="flex h-[70vh] items-center justify-center overflow-auto bg-[var(--cream2)]">
          {isPdf(record.file_name ?? record.file_path ?? "") ? (
            <iframe src={href} title={`${name} attachment`} className="h-full w-full border-0" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={name} className="max-h-full max-w-full object-contain" />
          )}
        </div>

        <div className="border-t border-[var(--divider)] px-5 py-3">
          {/* Same opt-in escape hatch as the document viewer: iOS Safari
              renders only the first page of an iframed PDF. */}
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
