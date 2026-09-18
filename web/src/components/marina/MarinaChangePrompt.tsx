"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { revokeMarinaAccessForVessel } from "@/lib/marina-actions";

/**
 * Raised after the owner saves a different marina name on a vessel that
 * marinas can see (docs/moxie_digital_marina_access_spec.md §2.4). Access
 * never expires, so this is the moment the relationship actually ends —
 * and the owner is already thinking about it.
 *
 * A prompt, not an automatic revocation: a marina name gets corrected for
 * a typo, and silently cutting access on a spelling fix is the invisible
 * decay no-expiry exists to avoid. Removing is the default (pre-ticked,
 * primary button); keeping is one click.
 */

export function MarinaChangePrompt({
  mxeId,
  vesselName,
  newMarinaName,
  grants,
  onClose,
}: {
  mxeId: string;
  vesselName: string;
  newMarinaName: string | null;
  grants: { id: string; marinaName: string }[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(() => new Set(grants.map((g) => g.id)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const names = grants.map((g) => g.marinaName);
  const question =
    grants.length === 1
      ? `Remove ${names[0]}'s access?`
      : "Remove access for the marinas you've left?";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Marina access after changing marina"
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(13,31,53,0.6)] p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-[var(--white)] p-6 shadow-xl">
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          You&apos;ve changed {vesselName}&apos;s marina{newMarinaName ? ` to ${newMarinaName}` : ""}.
        </p>
        <h2 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">{question}</h2>
        <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          {grants.length === 1 ? "They can" : "These marinas can"} still see your contact details when staff scan{" "}
          {vesselName}&apos;s badge. Access doesn&apos;t expire on its own. They won&apos;t be notified either way.
        </p>

        {grants.length > 1 ? (
          <div className="mt-3 space-y-1.5">
            {grants.map((g) => (
              <label key={g.id} className="flex items-center gap-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--navy)]"
                  checked={selected.has(g.id)}
                  disabled={pending}
                  onChange={(e) =>
                    setSelected((prev) => {
                      const next = new Set(prev);
                      if (e.target.checked) next.add(g.id);
                      else next.delete(g.id);
                      return next;
                    })
                  }
                />
                {g.marinaName}
              </label>
            ))}
          </div>
        ) : null}

        {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            disabled={pending}
            onClick={onClose}
            className="rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
          >
            Keep access
          </button>
          <button
            type="button"
            disabled={pending || selected.size === 0}
            onClick={() =>
              startTransition(async () => {
                setError(null);
                for (const id of selected) {
                  const result = await revokeMarinaAccessForVessel(mxeId, id);
                  if (result.error) {
                    setError(result.error);
                    router.refresh();
                    return;
                  }
                }
                router.refresh();
                onClose();
              })
            }
            className="flex-1 rounded-lg bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.12em] text-[var(--gold)]"
          >
            {pending ? "Removing…" : "Remove access"}
          </button>
        </div>
      </div>
    </div>
  );
}
