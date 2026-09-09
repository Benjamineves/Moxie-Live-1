"use client";

import { useState, useTransition } from "react";
import { advanceBatchStatus } from "./status-actions";

/**
 * The two batch-level transitions (spec §5.0.4), each showing its
 * precondition rather than being enabled and then failing.
 *
 * The greying is a courtesy, not the control. The real gate is in
 * advance_badge_batch_status (20260925) — if this component were wrong
 * about whether a batch is ready, the database would still refuse. That
 * ordering matters: it means the UI can be simple and slightly stale
 * without ever being the thing that lets an unrendered batch reach the
 * shelf.
 */
export function BatchStatusControls({
  batchId,
  counts,
  missingArtwork,
}: {
  batchId: string;
  counts: Record<string, number>;
  missingArtwork: number;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  const live = (counts.minted ?? 0) + (counts.printed ?? 0) + (counts.in_stock ?? 0) + (counts.assigned ?? 0);
  const allMinted = live > 0 && (counts.minted ?? 0) === live;
  const allPrinted = live > 0 && (counts.printed ?? 0) === live;

  function run(toStatus: "printed" | "in_stock") {
    setMessage(null);
    setFailed(false);
    startTransition(async () => {
      const result = await advanceBatchStatus(batchId, toStatus);
      if (result.error) {
        setFailed(true);
        setMessage(result.error);
      } else {
        setFailed(false);
        setMessage(`Advanced ${result.advanced} identities to ${toStatus.replace("_", " ")}.`);
      }
    });
  }

  const printedBlocker =
    !allMinted
      ? allPrinted || (counts.in_stock ?? 0) > 0
        ? "already advanced"
        : "batch is not all minted"
      : missingArtwork > 0
        ? `${missingArtwork} of ${live} still rendering`
        : null;

  const stockBlocker = !allPrinted
    ? (counts.in_stock ?? 0) > 0
      ? "already in stock"
      : "not printed yet"
    : missingArtwork > 0
      ? `${missingArtwork} of ${live} missing artwork`
      : null;

  return (
    <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
      <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Batch status
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <StatusStep label="minted" active={allMinted} />
        <Arrow />
        <AdvanceButton
          label="Mark printed"
          hint="Sheets received and inspected"
          blocker={printedBlocker}
          pending={pending}
          onClick={() => run("printed")}
        />
        <Arrow />
        <AdvanceButton
          label="Mark in stock"
          hint="Cut, finished, on the shelf"
          blocker={stockBlocker}
          pending={pending}
          onClick={() => run("in_stock")}
        />
      </div>

      {message ? (
        <p
          className={`mt-3 font-[family-name:var(--font-dm)] text-xs ${
            failed ? "text-[var(--red-fg)]" : "text-[var(--green-fg)]"
          }`}
        >
          {message}
        </p>
      ) : null}
    </div>
  );
}

function StatusStep({ label, active }: { label: string; active: boolean }) {
  return (
    <span
      className={`rounded-lg px-2 py-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.06em] ${
        active ? "bg-[var(--blue-bg)] text-[var(--blue-fg)]" : "bg-[var(--cream)] text-[var(--text3)]"
      }`}
    >
      {label}
    </span>
  );
}

function Arrow() {
  return <span className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">→</span>;
}

function AdvanceButton({
  label,
  hint,
  blocker,
  pending,
  onClick,
}: {
  label: string;
  hint: string;
  blocker: string | null;
  pending: boolean;
  onClick: () => void;
}) {
  const disabled = blocker !== null || pending;
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={blocker ?? hint}
        className={`rounded-lg px-3 py-1.5 font-[family-name:var(--font-dm)] text-xs font-medium ${
          disabled
            ? "cursor-not-allowed bg-[var(--cream)] text-[var(--text3)]"
            : "bg-[var(--navy)] text-[var(--white)]"
        }`}
      >
        {label}
      </button>
      <span className="mt-0.5 font-[family-name:var(--font-dm)] text-[9px] text-[var(--text3)]">
        {blocker ?? hint}
      </span>
    </span>
  );
}
