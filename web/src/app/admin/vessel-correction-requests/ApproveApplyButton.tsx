"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { approveAndApplyCorrection } from "./actions";

export function ApproveApplyButton({
  requestId,
  mxeId,
  fieldLabel,
  currentValue,
  requestedValue,
}: {
  requestId: string;
  mxeId: string;
  fieldLabel: string;
  currentValue: string;
  requestedValue: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await approveAndApplyCorrection(requestId);
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirming(false);
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md border border-[var(--gold-line)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)]"
      >
        Approve &amp; apply
      </button>
      {error ? (
        <p className="mt-1 max-w-[200px] text-right font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Apply this correction?"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={onConfirm}
      >
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          This writes <span className="font-medium text-[var(--navy)]">{fieldLabel}</span> on{" "}
          <span className="font-medium text-[var(--navy)]">{mxeId}</span> directly:
        </p>
        <p className="mt-2 font-[family-name:var(--font-dm)] text-sm">
          <span className="text-[var(--text3)] line-through">{currentValue || "—"}</span>
          {" → "}
          <span className="font-medium text-[var(--navy)]">{requestedValue}</span>
        </p>
      </ConfirmDialog>
    </>
  );
}
