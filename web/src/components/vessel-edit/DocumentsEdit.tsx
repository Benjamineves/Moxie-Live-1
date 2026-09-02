"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVesselDocument, type DocType } from "@/lib/vessel-uploads";
import { updateVesselDocument } from "@/lib/owner-actions";
import { isDocumentLocked, type DocumentSlot } from "@/lib/vessel-transfer";

type DocRow = { docType: DocType; label: string; url: string | null };

function fileNameFromPath(path: string) {
  return path.split("/").pop() || path;
}

function DocumentRow({ mxeId, docType, label, url }: DocRow & { mxeId: string }) {
  const router = useRouter();
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
    if (file.size > 10 * 1024 * 1024) {
      setError("Max upload size is 10MB.");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const path = await uploadVesselDocument(file, mxeId, docType);
      const result = await updateVesselDocument(mxeId, docType, path);
      if (result.error) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0">
      <div>
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{label}</p>
        <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          {url ? fileNameFromPath(url) : "No file uploaded"}
        </p>
        {error ? <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p> : null}
      </div>
      <label className="shrink-0 cursor-pointer rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)]">
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
  );
}

/** Locked row — visible, never hidden, never deleted, just not openable. */
function LockedDocumentRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0 opacity-70">
      <div>
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{label}</p>
        <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          On file, locked on Basic
        </p>
      </div>
      <span className="shrink-0 rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gold)]">
        🔒 Unlock with Full Access
      </span>
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
  subscriptionTier,
}: {
  mxeId: string;
  doc_registration_url: string | null | undefined;
  doc_insurance_url: string | null | undefined;
  doc_boater_card_url: string | null | undefined;
  subscriptionTier: "basic" | "full";
}) {
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
          <DocumentRow key={slot.docType} mxeId={mxeId} docType={slot.docType} label={labels[slot.docType]} url={slot.url} />
        ),
      )}
      <DocumentRow mxeId={mxeId} docType="boater_card" label="CA boater card" url={doc_boater_card_url ?? null} />
    </div>
  );
}
