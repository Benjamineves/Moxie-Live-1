"use client";

import { useState, useTransition } from "react";
import { backfillStorageZip } from "@/app/admin/geography/actions";
import { US_STATES } from "@/lib/us-states";

/**
 * One Missing ZIP vessel: what its owner typed, and a ZIP box. A state
 * picker appears only when the vessel has no state on file — otherwise the
 * ZIP is checked against the stored state, which this never changes.
 * Validation and the county are the server's (backfillStorageZip).
 */
export function MissingZipRow({
  mxeId,
  vesselName,
  storedState,
  rawLocation,
}: {
  mxeId: string;
  vesselName: string | null;
  storedState: string | null;
  rawLocation: string | null;
}) {
  const [zip, setZip] = useState("");
  const [state, setState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [savedCounty, setSavedCounty] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const text = "font-[family-name:var(--font-dm)] text-xs";
  const input =
    "rounded-md border border-[var(--divider)] bg-[var(--white)] px-2 py-1 font-[family-name:var(--font-dm)] text-xs text-[var(--navy)]";

  return (
    <li className="flex flex-col gap-1 border-b border-[var(--divider)] py-2 last:border-b-0">
      <p className={`${text} text-[var(--text2)]`}>
        <span className="font-semibold text-[var(--navy)]">{mxeId}</span>
        {vesselName ? ` ${vesselName}` : ""}: {rawLocation ?? "(no location entered)"}
      </p>
      {savedCounty ? (
        <p className={`${text} text-[var(--aqua-lagoon)]`}>
          Saved {zip.trim()} — {savedCounty}.
        </p>
      ) : (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            startTransition(async () => {
              const result = await backfillStorageZip(mxeId, zip, storedState ? null : state || null);
              if (result.error) setError(result.error);
              else setSavedCounty(result.county ?? "");
            });
          }}
        >
          {storedState ? null : (
            <select
              aria-label={`State for ${mxeId}`}
              value={state}
              onChange={(e) => setState(e.target.value)}
              className={input}
            >
              <option value="">State…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.code}
                </option>
              ))}
            </select>
          )}
          <input
            aria-label={`ZIP for ${mxeId}`}
            value={zip}
            onChange={(e) => setZip(e.target.value)}
            inputMode="numeric"
            maxLength={10}
            placeholder={storedState ? `ZIP in ${storedState}` : "ZIP"}
            className={`${input} w-28`}
          />
          <button
            type="submit"
            disabled={pending || !zip.trim()}
            className="rounded-md bg-[var(--navy)] px-3 py-1 font-[family-name:var(--font-dm)] text-xs font-semibold text-[var(--gold)] disabled:opacity-50"
          >
            {pending ? "Saving…" : "Save ZIP"}
          </button>
          {error ? <span className={`${text} w-full text-[var(--red-fg)]`}>{error}</span> : null}
        </form>
      )}
    </li>
  );
}
