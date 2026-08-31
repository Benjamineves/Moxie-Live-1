"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadCorrectionRequestDocument } from "@/lib/vessel-uploads";
import { submitIdentityCorrectionRequest } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type LockedField = "hin" | "make" | "model" | "year" | "length_ft" | "draft_ft" | "engine";

const FIELD_LABELS: Record<LockedField, string> = {
  hin: "HIN",
  make: "Make",
  model: "Model",
  year: "Year",
  length_ft: "Length (ft)",
  draft_ft: "Draft (ft)",
  engine: "Engine",
};

/**
 * hin/make/model/year/length_ft/draft_ft/engine have no direct edit path
 * (see owner-actions.ts) — this is the request path instead. A current
 * registration or title document showing the corrected value is required
 * as part of the request; nothing here verifies it against the typed
 * value automatically, an admin reviews it manually (see
 * /admin/vessel-correction-requests). Submitting a request doesn't change
 * anything on the vessel itself.
 */
export function RequestIdentityCorrection({
  mxeId,
  currentValues,
}: {
  mxeId: string;
  currentValues: Record<LockedField, string | number | null | undefined>;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [field, setField] = useState<LockedField>("hin");
  const [requestedValue, setRequestedValue] = useState("");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={editTriggerClass}>
        Notice an error in HIN, make, model, year, length, draft, or engine? Request a correction
      </button>
    );
  }

  if (submitted) {
    return (
      <div className="mx-auto mt-3 max-w-lg rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
          Request submitted — an admin will review it and update the record if it checks out.
        </p>
      </div>
    );
  }

  async function onSubmit() {
    setError(null);
    if (!requestedValue.trim()) {
      setError("Enter the corrected value.");
      return;
    }
    if (!file) {
      setError("Attach a current registration or title document showing the corrected value.");
      return;
    }
    const isAllowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!isAllowed) {
      setError("Document must be a PDF or image.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Max upload size is 10MB.");
      return;
    }

    setPending(true);
    try {
      const documentPath = await uploadCorrectionRequestDocument(file, mxeId);
      const result = await submitIdentityCorrectionRequest(
        mxeId,
        field,
        requestedValue.trim(),
        documentPath,
        notes.trim() || null,
      );
      if (result.error) throw new Error(result.error);
      setSubmitted(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit request.");
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="mx-auto mt-3 max-w-lg grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
        These fields identify the physical vessel and can&apos;t be self-edited. A support-mediated review requires
        a current registration or title document showing the corrected value.
      </p>
      <label className={labelClass}>
        Field
        <select className={inputClass} value={field} onChange={(e) => setField(e.target.value as LockedField)}>
          {(Object.keys(FIELD_LABELS) as LockedField[]).map((f) => (
            <option key={f} value={f}>
              {FIELD_LABELS[f]} (currently: {currentValues[f] ?? "—"})
            </option>
          ))}
        </select>
      </label>
      <label className={labelClass}>
        Corrected value
        <input className={inputClass} value={requestedValue} onChange={(e) => setRequestedValue(e.target.value)} />
      </label>
      <label className={labelClass}>
        Supporting document (registration or title, PDF or image)
        <input
          type="file"
          accept="application/pdf,image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          className={inputClass}
        />
      </label>
      <label className={labelClass}>
        Notes (optional)
        <textarea className={`${inputClass} min-h-16`} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <div className="flex gap-2.5">
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className={cancelButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={onSubmit} disabled={pending} className={saveButtonClass}>
          {pending ? "Submitting…" : "Submit request"}
        </button>
      </div>
    </div>
  );
}
