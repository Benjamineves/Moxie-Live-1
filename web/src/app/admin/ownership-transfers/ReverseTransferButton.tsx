"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { reverseOwnershipTransfer } from "./actions";

export function ReverseTransferButton({ transferId, mxeId }: { transferId: string; mxeId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await reverseOwnershipTransfer(transferId);
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
        className="rounded-md border border-[var(--divider)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text2)] transition hover:bg-[var(--cream2)]"
      >
        Reverse
      </button>
      {error ? (
        <p className="mt-1 max-w-[240px] text-right font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Reverse this transfer?"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={onConfirm}
      >
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          <span className="font-medium text-[var(--navy)]">{mxeId}</span> goes back to the seller&apos;s account.
          This undoes ownership only — anything the current owner has edited or added since the transfer stays as-is,
          not rewound.
        </p>
      </ConfirmDialog>
    </>
  );
}
