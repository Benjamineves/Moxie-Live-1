"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { changeMarinaAccessDocuments, revokeMarinaAccessForVessel } from "@/lib/marina-actions";

export type OwnerMarinaGrant = {
  id: string;
  marinaName: string;
  marinaCity: string | null;
  share_registration: boolean;
  share_insurance: boolean;
};

/**
 * The owner's list of marinas that can see this vessel, on their own
 * vessel page. docs/moxie_digital_marina_access_spec.md §2.4–2.5.
 *
 * Granting happens with the marina's code at /marina/join, not here — the
 * code is what names the marina, and its name preview is the owner's only
 * check. Here the owner changes which documents a marina sees, or removes
 * it. Removing is always allowed, dormant or not; changing documents is not
 * while dormant, because sharing is suspended then (the RPC refuses too).
 */
export function MarinaAccessPanel({
  mxeId,
  vesselName,
  grants,
  dormant,
}: {
  mxeId: string;
  vesselName: string;
  grants: OwnerMarinaGrant[];
  dormant: boolean;
}) {
  return (
    <div className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <h3 className="font-[family-name:var(--font-dm)] text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Marinas with access
      </h3>
      {grants.length === 0 ? (
        <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          No marina can see {vesselName}&apos;s contact details.
        </p>
      ) : (
        <div className="mt-2 divide-y divide-[var(--divider)]">
          {grants.map((g) => (
            <GrantRow key={g.id} mxeId={mxeId} grant={g} dormant={dormant} />
          ))}
        </div>
      )}
      {!dormant ? (
        <Link
          href="/marina/join"
          className="mt-4 inline-block font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold-deep)] underline underline-offset-2"
        >
          Share with a marina — enter its code
        </Link>
      ) : null}
    </div>
  );
}

function GrantRow({ mxeId, grant, dormant }: { mxeId: string; grant: OwnerMarinaGrant; dormant: boolean }) {
  const router = useRouter();
  const [reg, setReg] = useState(grant.share_registration);
  const [ins, setIns] = useState(grant.share_insurance);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const changed = reg !== grant.share_registration || ins !== grant.share_insurance;

  function run(action: () => Promise<{ error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.error) {
        setError(result.error);
        return;
      }
      setConfirmRemove(false);
      router.refresh();
    });
  }

  return (
    <div className="py-3">
      <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">{grant.marinaName}</p>
      {grant.marinaCity ? <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{grant.marinaCity}</p> : null}
      <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
        Sees your contact details, emergency contact and slip number. Doesn&apos;t expire.
      </p>

      <div className="mt-2 space-y-1.5">
        {(
          [
            ["registration", reg, setReg],
            ["insurance", ins, setIns],
          ] as const
        ).map(([label, value, set]) => (
          <label key={label} className="flex items-center gap-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            <input
              type="checkbox"
              className="h-4 w-4 accent-[var(--navy)]"
              checked={value}
              disabled={dormant || pending}
              onChange={(e) => set(e.target.checked)}
            />
            Include {label} document
          </label>
        ))}
      </div>

      {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}

      {confirmRemove ? (
        <div className="mt-3 rounded-lg border border-[var(--divider)] bg-[var(--cream)] p-3">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            Remove {grant.marinaName}&apos;s access? They won&apos;t be notified.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirmRemove(false)}
              className="rounded-md border border-[var(--divider)] bg-[var(--white)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
            >
              Keep
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => revokeMarinaAccessForVessel(mxeId, grant.id))}
              className="rounded-md bg-[var(--navy)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--danger-on-dark)]"
            >
              {pending ? "Removing…" : "Remove access"}
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {changed && !dormant ? (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => changeMarinaAccessDocuments(mxeId, grant.id, reg, ins))}
              className="rounded-md bg-[var(--navy)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
            >
              {pending ? "Saving…" : "Save changes"}
            </button>
          ) : null}
          <button
            type="button"
            disabled={pending}
            onClick={() => setConfirmRemove(true)}
            className="rounded-md border border-[var(--divider)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]"
          >
            Remove access
          </button>
        </div>
      )}
    </div>
  );
}
