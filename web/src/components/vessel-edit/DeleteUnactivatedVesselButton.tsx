"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { deleteUnactivatedVessel } from "@/lib/owner-actions";

/**
 * Genuine hard delete — unlike decommission, there's nothing to
 * preserve (nothing paid for, no public profile ever existed). Only
 * ever rendered where the caller has already confirmed the vessel is
 * showing "needs activation" — the real enforcement lives server-side
 * in deleteUnactivatedVessel / delete_unactivated_vessel, not here.
 */
export function DeleteUnactivatedVesselButton({
  mxeId,
  vesselName,
  redirectTo,
}: {
  mxeId: string;
  vesselName: string;
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function onConfirm() {
    setError(null);
    startTransition(async () => {
      const result = await deleteUnactivatedVessel(mxeId);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)] underline decoration-[var(--red-fg)] underline-offset-2"
      >
        Delete this vessel instead
      </button>
      {error ? (
        <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Delete this vessel?"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={onConfirm}
      >
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          <span className="font-medium text-[var(--navy)]">
            {vesselName} ({mxeId})
          </span>{" "}
          and everything on it — uploaded photo, documents, the identity itself — is permanently deleted. This
          can&apos;t be undone, and this MXE ID will never be issued again.
        </p>
        <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          Only available because this vessel was never activated. Nothing has been charged.
        </p>
      </ConfirmDialog>
    </>
  );
}
