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
        Decommission this vessel
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
      {/*
        A nudge, never a gate. "Sold outside Moxie" is the one reason
        where decommissioning is very often the wrong tool for what the
        owner actually wants: a transfer keeps the badge on the hull and
        carries the vessel's documents to the buyer, where decommission
        ends the record and leaves the new owner registering from
        scratch. Submission stays enabled throughout — plenty of sales
        genuinely close before anyone hears of Moxie, and second-guessing
        the owner there would be presumptuous.
      */}
      {reason === "sold_outside_moxie" ? (
        <div className="rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] p-4">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
            Selling this vessel?
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs leading-relaxed text-[var(--text2)]">
            Transfer Ownership keeps this vessel&apos;s badge and full document history with the new owner — no new
            sticker, nothing to re-upload — for a small one-time fee.
          </p>
          <a
            href="#transfer-ownership"
            className="mt-2.5 inline-block font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.1em] text-[var(--gold)] underline decoration-[var(--gold-line)] underline-offset-2"
          >
            Transfer ownership instead
          </a>
        </div>
      ) : null}
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
