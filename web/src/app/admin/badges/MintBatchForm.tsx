"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { mintBadgeBatch } from "./actions";

const inputClass =
  "w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2";
const labelClass =
  "flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]";

/**
 * Minting is irreversible in the one way that matters: MXE IDs are drawn
 * from a sequence that never reuses a value, so a mistyped count burns
 * that many permanent identities. Hence a confirm step showing the two
 * numbers that differ (§1.6 — identities and physical badges are not the
 * same figure), and a submit button that disables itself for the whole
 * round trip rather than relying on the server-side guard alone.
 */
export function MintBatchForm() {
  const router = useRouter();
  const [label, setLabel] = useState("");
  const [count, setCount] = useState("100");
  const [copies, setCopies] = useState("2");
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [minted, setMinted] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const parsedCount = Number(count);
  const parsedCopies = Number(copies);
  const badges = Number.isFinite(parsedCount) && Number.isFinite(parsedCopies) ? parsedCount * parsedCopies : 0;
  const canSubmit = label.trim().length > 0 && parsedCount >= 1 && parsedCopies >= 1;

  function onMint() {
    setError(null);
    setMinted(null);
    startTransition(async () => {
      const result = await mintBadgeBatch({
        label: label.trim(),
        count: parsedCount,
        copiesPerIdentity: parsedCopies,
      });
      setConfirming(false);
      if (result.error) {
        setError(result.error);
        return;
      }
      setMinted(result.batchId ?? null);
      setLabel("");
      router.refresh();
    });
  }

  return (
    <section className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <h2 className="font-[family-name:var(--font-display)] text-xl font-light text-[var(--navy)]">Mint a batch</h2>
      <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
        Allocates permanent MXE IDs and generates a token for each. Artwork is rendered separately — every identity
        starts at <code>minted</code>, which is deliberately not pickable.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
        <label className={labelClass}>
          Batch label
          <input
            className={inputClass}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="2026-10 run 1"
            disabled={pending}
          />
        </label>
        <label className={labelClass}>
          Identities
          <input
            className={inputClass}
            type="number"
            min={1}
            max={500}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            disabled={pending}
          />
        </label>
        <label className={labelClass}>
          Copies each
          <input
            className={inputClass}
            type="number"
            min={1}
            max={10}
            value={copies}
            onChange={(e) => setCopies(e.target.value)}
            disabled={pending}
          />
        </label>
      </div>

      <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
        {parsedCount || 0} identities → <strong>{badges || 0} physical badges</strong>. The label must be unique; a
        repeat submission is rejected without using any MXE IDs.
      </p>

      {error ? (
        <p className="mt-3 rounded-lg border border-[var(--red-fg)] bg-[var(--red-bg)] p-3 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
          {error}
        </p>
      ) : null}
      {minted ? (
        <p className="mt-3 rounded-lg border border-[var(--green-fg)] bg-[var(--green-bg)] p-3 font-[family-name:var(--font-dm)] text-sm text-[var(--green-fg)]">
          Minted. Batch <code>{minted}</code> — artwork not yet rendered.
        </p>
      ) : null}

      {confirming ? (
        <div className="mt-4 rounded-lg border border-[var(--gold-line)] bg-[var(--gold-dim)] p-4">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
            Mint {parsedCount} identities as &ldquo;{label.trim()}&rdquo;?
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            This permanently allocates {parsedCount} MXE IDs. They are never reused, including if the batch is later
            voided — so a wrong number here burns that many identities for good.
          </p>
          <div className="mt-3 flex gap-2.5">
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={pending}
              className="rounded-lg border border-[var(--divider)] bg-[var(--white)] px-4 py-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] disabled:opacity-40"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onMint}
              disabled={pending}
              className="rounded-lg bg-[var(--navy-deep)] px-4 py-2 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)] disabled:opacity-40"
            >
              {pending ? "Minting…" : `Mint ${parsedCount} identities`}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          disabled={!canSubmit || pending}
          className="mt-4 rounded-lg bg-[var(--navy-deep)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)] disabled:opacity-40"
        >
          Mint batch…
        </button>
      )}
    </section>
  );
}
