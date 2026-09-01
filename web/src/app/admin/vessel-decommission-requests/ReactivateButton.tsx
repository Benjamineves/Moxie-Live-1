"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { reactivateVessel } from "./actions";

export function ReactivateButton({ vesselId, mxeId }: { vesselId: string; mxeId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await reactivateVessel(vesselId);
      if (result.error) {
        // Cap-exceeded message comes straight from reactivate_vessel's
        // own RAISE EXCEPTION text — already specific and actionable, no
        // need to rewrap it.
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
        Reactivate
      </button>
      {error ? (
        <p className="mt-1 max-w-[240px] text-right font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Reactivate this vessel?"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={onConfirm}
      >
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          <span className="font-medium text-[var(--navy)]">{mxeId}</span> rejoins the owner&apos;s active fleet and
          counts against their 5-vessel cap again. Blocked automatically if it would push them over.
        </p>
      </ConfirmDialog>
    </>
  );
}
