"use client";

import { useState, useTransition } from "react";
import { voidBadgeIdentity } from "./status-actions";

/**
 * Voids one identity with a reason (spec §5.0.4) — per identity because
 * damage is per object, not per batch.
 *
 * The reason is required and typed, not picked from a list: the useful
 * cases are things like "creased in finishing" and "misfed, sheet 3",
 * which no enumeration would have guessed. It is stored on the row so a
 * burned MXE ID is always traceable to why.
 *
 * Assigned identities are refused by the database, not hidden here. The
 * control still appears on them so the refusal is visible and explains
 * itself rather than leaving an admin wondering where the button went.
 */
export function VoidBadgeButton({
  identityId,
  mxeId,
  batchId,
}: {
  identityId: string;
  mxeId: string;
  batchId: string;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--text3)] underline-offset-2 hover:underline"
      >
        Void
      </button>
    );
  }

  return (
    <div className="mt-1.5 text-left">
      <label className="font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.06em] text-[var(--text3)]">
        Reason for voiding {mxeId}
      </label>
      <input
        autoFocus
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="creased in finishing"
        className="mt-1 w-full rounded-lg border border-[var(--divider)] px-2 py-1 font-[family-name:var(--font-dm)] text-[10px]"
      />
      {error ? (
        <p className="mt-1 font-[family-name:var(--font-dm)] text-[9px] text-[var(--red-fg)]">{error}</p>
      ) : null}
      <div className="mt-1 flex gap-1.5">
        <button
          type="button"
          disabled={pending || reason.trim() === ""}
          onClick={() => {
            setError(null);
            startTransition(async () => {
              const result = await voidBadgeIdentity(identityId, reason, batchId);
              if (result.error) setError(result.error);
              else setOpen(false);
            });
          }}
          className="rounded-lg bg-[var(--red-fg)] px-2 py-1 font-[family-name:var(--font-dm)] text-[9px] font-semibold text-[var(--white)] disabled:opacity-50"
        >
          {pending ? "Voiding…" : "Confirm void"}
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="rounded-lg px-2 py-1 font-[family-name:var(--font-dm)] text-[9px] text-[var(--text3)]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
