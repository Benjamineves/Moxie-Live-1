"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RENDER_CHUNK_SIZE } from "@/lib/badge-render-chunk";
import { renderBatchArtworkChunk } from "./render-actions";

/**
 * Drives the chunked render (§5.0.5) from one click, calling the action
 * repeatedly until the batch reports done.
 *
 * The loop lives in the browser rather than the server on purpose: each
 * invocation then gets its own function budget, so batch size is
 * unbounded by Vercel's per-request ceiling — 100 identities is five
 * calls of ~5 s rather than one of ~60 s that Hobby would kill outright.
 *
 * It is also why "Resume" and "Render" are the same button. Nothing
 * about resuming is a special path: the action always asks for rows
 * where artwork_path IS NULL, so a first run and a run after a crash are
 * the same query. The label changes; the code does not.
 */
export function RenderArtworkButton({
  batchId,
  pendingCount,
  totalCount,
}: {
  batchId: string;
  pendingCount: number;
  totalCount: number;
}) {
  const router = useRouter();
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(totalCount - pendingCount);
  const [error, setError] = useState<string | null>(null);

  const complete = pendingCount === 0;

  async function run() {
    setRunning(true);
    setError(null);
    let completed = totalCount - pendingCount;

    // Bounded so a persistently-failing chunk cannot spin forever. Each
    // pass must make progress or the loop stops and says so.
    for (let pass = 0; pass < Math.ceil(totalCount / RENDER_CHUNK_SIZE) + 2; pass += 1) {
      const result = await renderBatchArtworkChunk(batchId);
      completed += result.rendered ?? 0;
      setDone(completed);

      if (result.error) {
        setError(result.error);
        break;
      }
      if (result.done) break;
      if (!result.rendered) {
        setError("A chunk reported no progress. Stopping rather than looping.");
        break;
      }
    }

    setRunning(false);
    router.refresh();
  }

  if (complete && !running && !error) {
    return (
      <p className="font-[family-name:var(--font-dm)] text-[10px] text-[var(--green-fg)]">
        artwork complete
      </p>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={run}
        disabled={running}
        className="rounded-md border border-[var(--gold-line)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)] disabled:opacity-40"
      >
        {running
          ? `Rendering… ${done} / ${totalCount}`
          : done > 0
            ? "Resume render"
            : "Render artwork"}
      </button>
      {error ? (
        <p className="max-w-[260px] text-right font-[family-name:var(--font-dm)] text-[10px] leading-snug text-[var(--red-fg)]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
