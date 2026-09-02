"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptOwnershipTransfer } from "./actions";

export function AcceptTransferButton({ transferId }: { transferId: string }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onAccept() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await acceptOwnershipTransfer(transferId);
        if (result.error) {
          setError(result.error);
          return;
        }
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not accept this transfer. Please try again.");
      }
    });
  }

  return (
    <div>
      {error ? (
        <div className="mb-3 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
          <button
            type="button"
            onClick={onAccept}
            disabled={pending}
            className="mt-3 rounded-lg border border-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)] disabled:opacity-50"
          >
            {pending ? "Retrying…" : "Try again"}
          </button>
        </div>
      ) : null}
      <button
        type="button"
        onClick={onAccept}
        disabled={pending}
        className="w-full rounded-lg bg-[var(--aqua-bright)] px-6 py-3.5 font-[family-name:var(--font-dm)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--navy-deep)] disabled:opacity-50"
      >
        {pending ? "Accepting…" : "Accept this vessel →"}
      </button>
    </div>
  );
}
