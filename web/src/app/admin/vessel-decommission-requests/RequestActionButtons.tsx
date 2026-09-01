"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { approveDecommission, declineDecommission } from "./actions";

export function RequestActionButtons({
  requestId,
  mxeId,
  reasonLabel,
}: {
  requestId: string;
  mxeId: string;
  reasonLabel: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<"approve" | "decline" | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onApprove() {
    setError(null);
    startTransition(async () => {
      const result = await approveDecommission(requestId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  function onDecline() {
    setError(null);
    startTransition(async () => {
      const result = await declineDecommission(requestId, declineReason.trim() || null);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirming(null);
      router.refresh();
    });
  }

  return (
    <>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming("approve")}
          className="rounded-md border border-[var(--gold-line)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)]"
        >
          Approve
        </button>
        <button
          type="button"
          onClick={() => setConfirming("decline")}
          className="rounded-md border border-[var(--divider)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text2)] transition hover:bg-[var(--cream2)]"
        >
          Decline
        </button>
      </div>
      {error ? (
        <p className="mt-1 max-w-[220px] text-right font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming === "approve"}
        title="Approve this decommission?"
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={onApprove}
      >
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          <span className="font-medium text-[var(--navy)]">{mxeId}</span> ({reasonLabel}) leaves the owner&apos;s
          active fleet, stops counting against their vessel cap, and every active share link for it is revoked. The
          vessel record, documents, and history all stay intact.
        </p>
      </ConfirmDialog>

      <ConfirmDialog
        open={confirming === "decline"}
        title="Decline this request?"
        pending={pending}
        onCancel={() => setConfirming(null)}
        onConfirm={onDecline}
      >
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          <span className="font-medium text-[var(--navy)]">{mxeId}</span> stays in the owner&apos;s active fleet
          unchanged. Nothing is written to the vessel.
        </p>
        <label className="mt-3 flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          Reason (optional, shown to no one automatically)
          <textarea
            className="min-h-16 rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2 font-[family-name:var(--font-dm)] text-sm normal-case tracking-normal text-[var(--text)]"
            value={declineReason}
            onChange={(e) => setDeclineReason(e.target.value)}
          />
        </label>
      </ConfirmDialog>
    </>
  );
}
