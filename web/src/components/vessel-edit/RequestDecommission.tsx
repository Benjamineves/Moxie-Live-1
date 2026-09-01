"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { submitDecommissionRequest } from "@/lib/owner-actions";
import { DECOMMISSION_REASONS, DECOMMISSION_REASON_LABELS, type DecommissionReason } from "@/lib/vessel-decommission";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

/**
 * Archive/decommission a vessel — a status change an admin applies, never
 * a self-serve action or a deletion. This is the request half only;
 * approval (and the atomic status change + share revocation it triggers)
 * happens in /admin/vessel-decommission-requests.
 */
export function RequestDecommission({
  mxeId,
  hasPendingRequest,
}: {
  mxeId: string;
  hasPendingRequest: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<DecommissionReason>("wrong_vessel");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  if (hasPendingRequest || submitted) {
    return (
      <div className="mx-auto mt-3 max-w-lg rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
          Decommission request submitted — an admin will review it. This vessel stays on your dashboard until then.
        </p>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={editTriggerClass}>
        Wrong boat, duplicate, or no longer yours? Request to decommission this vessel
      </button>
    );
  }

  async function onSubmit() {
    setError(null);
    setPending(true);
    try {
      const result = await submitDecommissionRequest(mxeId, reason, notes.trim() || null);
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
        This is a status change, not a deletion — the vessel record, documents, and history all stay intact and
        viewable. An admin reviews every request before it takes effect.
      </p>
      <label className={labelClass}>
        Reason
        <select
          className={inputClass}
          value={reason}
          onChange={(e) => setReason(e.target.value as DecommissionReason)}
        >
          {DECOMMISSION_REASONS.map((r) => (
            <option key={r} value={r}>
              {DECOMMISSION_REASON_LABELS[r]}
            </option>
          ))}
        </select>
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
