"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { chooseActiveVessels } from "./actions";

type VesselOption = {
  id: string;
  mxeId: string;
  vesselName: string;
  vesselTag: string;
  photoUrl: string | null;
  isActive: boolean;
};

export function ManageFleetForm({
  tierLabel,
  limit,
  vessels,
}: {
  tierLabel: string;
  limit: number;
  vessels: VesselOption[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set(vessels.filter((v) => v.isActive).slice(0, limit).map((v) => v.id)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < limit) {
        next.add(id);
      }
      return next;
    });
  }

  function onSubmit() {
    setError(null);
    startTransition(async () => {
      const result = await chooseActiveVessels(Array.from(selected));
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl">
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Manage fleet
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
            Choose your <em className="text-[var(--gold)] not-italic">active vessels.</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Your {tierLabel} plan covers up to {limit} vessel{limit === 1 ? "" : "s"}. Pick which ones stay fully
            active — the rest go dormant: nothing is deleted, and you can change this any time.
          </p>
        </header>

        <div className="flex flex-col gap-3">
          {vessels.map((v) => {
            const checked = selected.has(v.id);
            const disabled = !checked && selected.size >= limit;
            return (
              <label
                key={v.id}
                className={`flex items-center gap-4 rounded-xl border p-4 shadow-sm transition ${
                  checked ? "border-[var(--gold)] bg-[var(--white)]" : "border-[var(--divider)] bg-[var(--white)]"
                } ${disabled ? "opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => toggle(v.id)}
                  className="h-5 w-5 shrink-0"
                />
                <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[var(--cream2)]">
                  {v.photoUrl?.startsWith("http") ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.photoUrl} alt={v.vesselName} className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-xl text-[var(--gold)]">⚓</div>
                  )}
                </div>
                <div className="min-w-0">
                  <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{v.mxeId}</p>
                  <p className="truncate font-[family-name:var(--font-display)] text-lg italic text-[var(--navy)]">
                    {v.vesselName}
                  </p>
                  <p className="truncate font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{v.vesselTag}</p>
                </div>
              </label>
            );
          })}
        </div>

        <p className="mt-3 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          {selected.size} of {limit} selected
        </p>

        {error ? (
          <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p>
        ) : null}

        <button
          type="button"
          onClick={onSubmit}
          disabled={pending || selected.size === 0}
          className="mt-6 w-full rounded-lg bg-[var(--aqua-bright)] px-6 py-3.5 font-[family-name:var(--font-dm)] text-sm font-bold uppercase tracking-[0.12em] text-[var(--navy-deep)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save active vessels →"}
        </button>
      </main>
    </div>
  );
}
