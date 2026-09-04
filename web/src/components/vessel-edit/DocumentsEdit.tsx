"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadVesselDocument, type DocType } from "@/lib/vessel-uploads";
import { updateVesselDocument, updateVesselOwnerFields, checkStorageCapacity } from "@/lib/owner-actions";
import { isDocumentLocked, type DocumentSlot } from "@/lib/vessel-transfer";
import { getOfflineMeta, openOfflineDocument } from "@/lib/offline-vessel-store";
import { useIsOnline } from "@/lib/use-is-online";
import type { DocumentFileMeta, VesselDocumentMeta } from "@/lib/document-metadata";

const DOC_TYPES: DocType[] = ["registration", "insurance", "boater_card"];
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The line under each document's label. Deliberately never derived from
 * the stored path: uploadVesselDocument writes to a deterministic
 * {userId}/{mxeId}/registration.pdf, so its basename is identical for
 * every vessel in the system and reads as a filename while carrying no
 * information at all. What's shown instead is the original upload name
 * (where we have one — recorded only since
 * 20260918_document_original_filenames.sql) plus the date and size of
 * the actual stored bytes, read from Storage.
 *
 * "On file" is the floor: a document uploaded before filenames were
 * recorded, whose Storage listing also failed, still gets an honest
 * label rather than a fabricated one.
 */
function describeDocument(meta: DocumentFileMeta | undefined): string {
  const parts: string[] = [];
  if (meta?.fileName) parts.push(meta.fileName);
  if (meta?.uploadedAt) {
    const date = formatUploadedAt(meta.uploadedAt);
    if (date) parts.push(`Uploaded ${date}`);
  }
  if (typeof meta?.sizeBytes === "number") parts.push(formatBytes(meta.sizeBytes));
  return parts.length > 0 ? parts.join(" · ") : "On file";
}

const ACTION_CLASS =
  "shrink-0 rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)]";

/**
 * One row per document slot — registration, insurance, boater card.
 * Previously two near-identical copies of this markup (the boater card's
 * only real difference is the ca_boater_card checkbox below it, which
 * comes in as `footer`), which is how the two drifted apart in the first
 * place.
 */
function DocumentFileRow({
  mxeId,
  docType,
  label,
  url,
  meta,
  offlineUrl,
  footer,
}: {
  mxeId: string;
  docType: DocType;
  label: string;
  url: string | null;
  meta: DocumentFileMeta | undefined;
  offlineUrl: string | undefined;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const isOnline = useIsOnline();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    const isAllowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!isAllowed) {
      setError("Document must be a PDF or image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Max upload size is 10MB.");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const capacity = await checkStorageCapacity(file.size);
      if (!capacity.ok) throw new Error(capacity.error);
      const { path, fileName } = await uploadVesselDocument(file, mxeId, docType);
      const result = await updateVesselDocument(mxeId, docType, path, fileName);
      if (result.error) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  // Online, View streams the live bytes from the owner-authenticated
  // proxy route (api/vessels/[mxeId]/documents/[docType]) — always
  // current, and the authoritative copy after a Replace. Offline, it
  // falls back to whatever "save for offline" already cached for this
  // vessel, which is the whole point of having cached it. Not the other
  // way round: preferring the cache while online would happily show
  // yesterday's document seconds after replacing it.
  const viewHref = isOnline
    ? `/api/vessels/${encodeURIComponent(mxeId)}/documents/${docType}`
    : offlineUrl;

  return (
    <div className="border-b border-[var(--divider)] py-3 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{label}</p>
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            {url ? describeDocument(meta) : "No file uploaded"}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {url && viewHref ? (
            <a href={viewHref} target="_blank" rel="noreferrer" className={ACTION_CLASS}>
              View
            </a>
          ) : null}
          {url && !viewHref ? (
            <span
              aria-disabled="true"
              className="shrink-0 rounded-md border border-[var(--divider)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text3)]"
            >
              View — needs a connection
            </span>
          ) : null}
          <label className={`${ACTION_CLASS} cursor-pointer`}>
            {uploading ? "Uploading…" : url ? "Replace" : "Add"}
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={uploading}
              onChange={(e) => onFileSelected(e.target.files)}
              className="hidden"
            />
          </label>
        </div>
      </div>
      {footer}
      {error ? <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p> : null}
    </div>
  );
}

/**
 * The boater card as one unit: the uploaded card file (the shared
 * DocumentFileRow above) plus the ca_boater_card checkbox, which used to
 * live disconnected from this in SafetyEdit's physical-equipment
 * checklist — life jackets, fire extinguisher, flares, sound device. A
 * boater card is a personal operator credential, not something bolted to
 * the boat, which is exactly why both the file and the checkbox are
 * owner-specific: they stay with the seller on ownership transfer
 * (complete_ownership_transfer clears both), and neither counts toward
 * the Basic document limit.
 *
 * The checkbox saves immediately on toggle, matching this component's
 * existing per-row auto-save behavior (file uploads here have never used
 * an edit/cancel/save step either) rather than introducing a different
 * interaction pattern for just this one field.
 */
function BoaterCardRow({
  mxeId,
  url,
  hasCard,
  meta,
  offlineUrl,
}: {
  mxeId: string;
  url: string | null;
  hasCard: boolean | null | undefined;
  meta: DocumentFileMeta | undefined;
  offlineUrl: string | undefined;
}) {
  const router = useRouter();
  const [savingCard, setSavingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  async function onToggleHasCard(checked: boolean) {
    setCardError(null);
    setSavingCard(true);
    try {
      const result = await updateVesselOwnerFields(mxeId, { ca_boater_card: checked });
      if (result.error) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingCard(false);
    }
  }

  return (
    <DocumentFileRow
      mxeId={mxeId}
      docType="boater_card"
      label="Boater Card"
      url={url}
      meta={meta}
      offlineUrl={offlineUrl}
      footer={
        <>
          <label className="mt-2 flex items-center gap-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            <input
              type="checkbox"
              checked={!!hasCard}
              disabled={savingCard}
              onChange={(e) => onToggleHasCard(e.target.checked)}
            />
            {savingCard ? "Saving…" : "Operator has a CA boater card on file"}
          </label>
          {cardError ? (
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{cardError}</p>
          ) : null}
        </>
      }
    />
  );
}

/** Locked row — visible, never hidden, never deleted, just not openable. No View: the proxy route 403s a locked document server-side too. */
function LockedDocumentRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0 opacity-70">
      <div>
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{label}</p>
        <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          On file, locked on Basic
        </p>
      </div>
      <Link
        href="/dashboard/upgrade"
        className="shrink-0 rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gold)] transition hover:bg-[var(--gold-dim)]"
      >
        🔒 Unlock with Full Access
      </Link>
    </div>
  );
}

/**
 * Registration/insurance/boater-card files replace in place — no version
 * history, overwriting just replaces what's there (build spec).
 *
 * Basic-tier document locking (BASIC_DOCUMENT_LIMIT, lib/vessel-transfer.ts):
 * a document beyond the limit is never hidden or deleted — it stays on
 * file, just not openable until upgrading. Boater card is always
 * exempt (personal credential, not counted either way) and never
 * transfers on ownership change, same reasoning.
 */
export function DocumentsEdit({
  mxeId,
  doc_registration_url,
  doc_insurance_url,
  doc_boater_card_url,
  ca_boater_card,
  subscriptionTier,
  documentMeta = {},
}: {
  mxeId: string;
  doc_registration_url: string | null | undefined;
  doc_insurance_url: string | null | undefined;
  doc_boater_card_url: string | null | undefined;
  ca_boater_card: boolean | null | undefined;
  subscriptionTier: "basic" | "full";
  /** Upload date/size/original filename per document, resolved server-side (lib/document-metadata.ts). */
  documentMeta?: VesselDocumentMeta;
}) {
  // Blob URLs for whatever this vessel has cached via "save for
  // offline", resolved once here rather than per row — same
  // openOfflineDocument path /offline-vessel already reads, so there's
  // one way to get at cached bytes, not two. Only touched when this
  // vessel actually has offline metadata: openOfflineDocument would
  // otherwise call caches.open() and create an empty cache for a vessel
  // that was never saved.
  const [offlineUrls, setOfflineUrls] = useState<Partial<Record<DocType, string>>>({});

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      // Deliberate microtask deferral — this repo's lint config errors on
      // a setState reachable synchronously from an effect body. Same
      // pattern as SaveOfflineControl.tsx and /offline-vessel.
      await Promise.resolve();
      if (cancelled || !getOfflineMeta(mxeId)) return;
      const urls: Partial<Record<DocType, string>> = {};
      for (const docType of DOC_TYPES) {
        const url = await openOfflineDocument(mxeId, docType);
        if (url) {
          urls[docType] = url;
          created.push(url);
        }
      }
      if (!cancelled) setOfflineUrls(urls);
    })();
    return () => {
      cancelled = true;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [mxeId]);

  // Fixed order — registration counts first, insurance second — so
  // which document (if any) shows locked stays stable across reloads.
  const slots: DocumentSlot[] = [
    { docType: "registration", url: doc_registration_url ?? null },
    { docType: "insurance", url: doc_insurance_url ?? null },
  ];
  const labels: Record<DocumentSlot["docType"], string> = { registration: "Registration", insurance: "Insurance card" };

  return (
    <div className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      {slots.map((slot, i) =>
        isDocumentLocked(slots, i, subscriptionTier) ? (
          <LockedDocumentRow key={slot.docType} label={labels[slot.docType]} />
        ) : (
          <DocumentFileRow
            key={slot.docType}
            mxeId={mxeId}
            docType={slot.docType}
            label={labels[slot.docType]}
            url={slot.url}
            meta={documentMeta[slot.docType]}
            offlineUrl={offlineUrls[slot.docType]}
          />
        ),
      )}
      <BoaterCardRow
        mxeId={mxeId}
        url={doc_boater_card_url ?? null}
        hasCard={ca_boater_card}
        meta={documentMeta.boater_card}
        offlineUrl={offlineUrls.boater_card}
      />
    </div>
  );
}
