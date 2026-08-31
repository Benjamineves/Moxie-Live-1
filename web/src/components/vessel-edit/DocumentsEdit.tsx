"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVesselDocument, type DocType } from "@/lib/vessel-uploads";
import { updateVesselDocument } from "@/lib/owner-actions";

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

/**
 * Registration/insurance/boater-card files replace in place — no version
 * history, overwriting just replaces what's there (build spec). Doesn't
 * check or reserve against the Basic-tier "+1 additional document" quota:
 * nothing in the codebase enforces that quota today (confirmed by
 * search), so there's nothing here for a replace to trip.
 */
export function DocumentsEdit({
  mxeId,
  doc_registration_url,
  doc_insurance_url,
  doc_boater_card_url,
}: {
  mxeId: string;
  doc_registration_url: string | null | undefined;
  doc_insurance_url: string | null | undefined;
  doc_boater_card_url: string | null | undefined;
}) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <DocumentRow mxeId={mxeId} docType="registration" label="Registration" url={doc_registration_url ?? null} />
      <DocumentRow mxeId={mxeId} docType="insurance" label="Insurance card" url={doc_insurance_url ?? null} />
      <DocumentRow mxeId={mxeId} docType="boater_card" label="CA boater card" url={doc_boater_card_url ?? null} />
    </div>
  );
}
