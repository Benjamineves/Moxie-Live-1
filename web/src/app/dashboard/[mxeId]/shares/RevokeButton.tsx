"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function RevokeButton({ mxeId, shareId }: { mxeId: string; shareId: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onRevoke() {
    setError(null);
    startTransition(async () => {
      const res = await fetch(`/api/vessels/${encodeURIComponent(mxeId)}/shares/${shareId}`, { method: "DELETE" });
      if (!res.ok) {
        const result = await res.json().catch(() => ({}));
        setError(result.error ?? "Could not revoke.");
        return;
      }
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onRevoke}
        disabled={pending}
        className="rounded-md border border-[var(--divider)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[9px] font-semibold uppercase tracking-[0.1em] text-[var(--text3)] transition hover:border-[var(--red-fg)] hover:text-[var(--red-fg)] disabled:opacity-50"
      >
        {pending ? "Revoking…" : "Revoke"}
      </button>
      {error ? <span className="font-[family-name:var(--font-dm)] text-[10px] text-[var(--red-fg)]">{error}</span> : null}
    </div>
  );
}
