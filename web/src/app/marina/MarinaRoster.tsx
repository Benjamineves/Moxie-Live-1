"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { rankRoster, type RosterRow } from "@/lib/marina-view";

/**
 * The harbormaster's daily screen. Used standing on a dock, on a phone:
 * the first job is reaching one boat in a couple of taps at 100+ vessels,
 * so search is the first thing on the page and filters are secondary.
 *
 * Client-side filtering over the whole list — a marina roster is hundreds
 * of rows at most, and results changing on every keystroke with no round
 * trip is what makes two taps possible on a weak dock signal.
 *
 * The two flags are the marina's prompt list: which tenants to ask for an
 * emergency contact, and which have shared no document. That is how owners
 * end up completing their records — asked by their harbormaster at the
 * dock, not reminded by us.
 */

type Filter = "all" | "no_emergency" | "no_documents";

const pill = "inline-flex items-center rounded-full px-2 py-0.5 font-[family-name:var(--font-dm)] text-[11px] font-semibold";

export function MarinaRoster({ rows }: { rows: RosterRow[] }) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const counts = useMemo(
    () => ({
      no_emergency: rows.filter((r) => !r.hasEmergencyContact).length,
      no_documents: rows.filter((r) => r.noDocuments === true).length,
    }),
    [rows],
  );

  const visible = useMemo(() => {
    const filtered = rows.filter((r) =>
      filter === "no_emergency" ? !r.hasEmergencyContact : filter === "no_documents" ? r.noDocuments === true : true,
    );
    return rankRoster(filtered, query);
  }, [rows, query, filter]);

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "all", label: "All", count: rows.length },
    { key: "no_emergency", label: "No emergency contact", count: counts.no_emergency },
    { key: "no_documents", label: "No documents", count: counts.no_documents },
  ];

  return (
    <div>
      <div className="sticky top-[57px] z-10 -mx-4 border-b border-[var(--divider)] bg-[var(--cream)] px-4 pb-3 pt-3">
        <label htmlFor="roster-search" className="sr-only">
          Search by boat name or slip
        </label>
        <input
          id="roster-search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Boat name or slip"
          className="w-full rounded-xl border border-[var(--divider)] bg-[var(--white)] px-4 py-3.5 font-[family-name:var(--font-dm)] text-lg text-[var(--navy)] placeholder:text-[var(--text3)]"
        />
        <div className="mt-2.5 flex flex-wrap gap-2">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={filter === chip.key}
              onClick={() => setFilter(chip.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 font-[family-name:var(--font-dm)] text-sm ${
                filter === chip.key
                  ? "border-[var(--navy)] bg-[var(--navy)] text-white"
                  : "border-[var(--divider)] bg-[var(--white)] text-[var(--navy)]"
              }`}
            >
              {chip.label} <span className="font-semibold">{chip.count}</span>
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="mt-6 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {query ? `No boat matches “${query}”.` : "No boats in this list."}
          </p>
          <button
            type="button"
            onClick={() => {
              setQuery("");
              setFilter("all");
            }}
            className="mt-2 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold-deep)] underline underline-offset-2"
          >
            Show all boats
          </button>
        </div>
      ) : (
        <ul className="mt-3 overflow-hidden rounded-xl border border-[var(--divider)] bg-[var(--white)]">
          {visible.map((row) => (
            <li key={row.mxe_id} className="border-b border-[var(--divider)] last:border-0">
              <Link
                href={`/${encodeURIComponent(row.mxe_id)}?role=marina`}
                className="flex items-center gap-3.5 px-4 py-3.5 active:bg-[var(--cream)]"
              >
                <span className="flex h-12 min-w-12 shrink-0 items-center justify-center rounded-lg bg-[var(--cream2)] px-2 font-[family-name:var(--font-dm)] text-base font-bold text-[var(--navy)]">
                  {row.slip ?? "—"}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-[family-name:var(--font-dm)] text-base font-semibold text-[var(--navy)]">
                    {row.vessel_name}
                  </span>
                  <span className="block truncate font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                    {[row.owner_name, row.mxe_id].filter(Boolean).join(" · ")}
                  </span>
                  <span className="mt-1 flex flex-wrap gap-1.5">
                    {row.paused ? <span className={`${pill} bg-[var(--gray-bg)] text-[var(--navy)]`}>Access paused</span> : null}
                    {!row.hasEmergencyContact ? (
                      <span className={`${pill} bg-[var(--red-bg)] text-[var(--red-fg)]`}>No emergency contact</span>
                    ) : null}
                    {row.noDocuments ? <span className={`${pill} bg-[var(--gold-dim)] text-[var(--navy)]`}>No documents</span> : null}
                  </span>
                </span>
                <span aria-hidden className="shrink-0 text-[var(--text3)]">
                  ›
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
