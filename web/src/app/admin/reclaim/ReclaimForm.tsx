"use client";

import { useState, useTransition } from "react";
import { previewReclaim, reclaimUnactivatedVessel, type ReclaimPreview } from "./actions";

/**
 * The confirmation flow for the one destructive operation in the badge
 * system.
 *
 * Three things make it hard to fire by accident, and they are all
 * deliberate:
 *
 * 1. You reach a vessel by typing its MXE ID. There is no list, so there
 *    is no adjacent row to hit by mistake and nothing to select in bulk.
 * 2. Every precondition is shown as a tick or a cross BEFORE the button
 *    exists, so you see why a vessel is eligible rather than finding out
 *    from a refusal.
 * 3. Deleting requires typing the MXE ID again, exactly, plus a reason
 *    that is stored forever.
 *
 * None of this is the control. The database refuses regardless — see
 * 20260927. This is what stops an admin getting as far as being refused.
 */
export function ReclaimForm() {
  const [query, setQuery] = useState("");
  const [preview, setPreview] = useState<ReclaimPreview | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function look() {
    setMessage(null);
    setPreview(null);
    setConfirmation("");
    setReason("");
    startTransition(async () => {
      const result = await previewReclaim(query);
      if ("error" in result) setMessage({ tone: "bad", text: result.error });
      else setPreview(result);
    });
  }

  function reclaim() {
    if (!preview) return;
    setMessage(null);
    startTransition(async () => {
      const result = await reclaimUnactivatedVessel(preview.vesselId, confirmation, reason);
      if (result.error) {
        setMessage({ tone: "bad", text: result.error });
      } else {
        setMessage({
          tone: result.warning ? "warn" : "ok",
          text: result.warning ?? `${result.mxeId} deleted. Its badge is back in stock.`,
        });
        setPreview(null);
        setQuery("");
        setConfirmation("");
        setReason("");
      }
    });
  }

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
        <label className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          MXE ID
        </label>
        <div className="mt-2 flex gap-2">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && look()}
            placeholder="MXE-01023"
            className="w-48 rounded-lg border border-[var(--divider)] px-3 py-2 font-[family-name:var(--font-dm)] text-sm"
          />
          <button
            type="button"
            onClick={look}
            disabled={pending || query.trim() === ""}
            className="rounded-lg bg-[var(--navy)] px-4 py-2 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--white)] disabled:opacity-50"
          >
            {pending ? "Checking…" : "Check"}
          </button>
        </div>
      </div>

      {message ? (
        <div
          className={`rounded-xl border p-4 font-[family-name:var(--font-dm)] text-sm ${
            message.tone === "ok"
              ? "border-[var(--green-fg)] bg-[var(--green-bg)] text-[var(--green-fg)]"
              : message.tone === "warn"
                ? "border-[var(--amber-fg)] bg-[var(--amber-bg)] text-[var(--amber-fg)]"
                : "border-[var(--red-fg)] bg-[var(--red-bg)] text-[var(--red-fg)]"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {preview ? (
        <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
            {preview.mxeId} · {preview.vesselName ?? "(unnamed)"}
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            {preview.ownerEmail ?? "no owner email"} · registered{" "}
            {preview.createdAt ? new Date(preview.createdAt).toLocaleString() : "unknown"}
          </p>

          <ul className="mt-4 space-y-1.5">
            {preview.checks.map((c) => (
              <li key={c.label} className="flex items-start gap-2 font-[family-name:var(--font-dm)] text-sm">
                <span className={c.ok ? "text-[var(--green-fg)]" : "text-[var(--red-fg)]"}>
                  {c.ok ? "✓" : "✗"}
                </span>
                <span className="text-[var(--text)]">
                  {c.label}
                  <span className="ml-2 text-xs text-[var(--text3)]">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>

          {preview.eligible ? (
            <div className="mt-5 rounded-lg border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
              <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--red-fg)]">
                This deletes the vessel permanently and returns {preview.mxeId} to stock.
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
                The vessel row, its uploaded photo and documents are removed. Only the reclaim log
                survives.
              </p>

              <label className="mt-3 block font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--red-fg)]">
                Reason (stored permanently)
              </label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="checkout abandoned, customer never returned"
                className="mt-1 w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2 font-[family-name:var(--font-dm)] text-sm"
              />

              <label className="mt-3 block font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--red-fg)]">
                Type {preview.mxeId} to confirm
              </label>
              <input
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                placeholder={preview.mxeId}
                className="mt-1 w-48 rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2 font-[family-name:var(--font-dm)] text-sm"
              />

              <div className="mt-4">
                <button
                  type="button"
                  onClick={reclaim}
                  disabled={
                    pending ||
                    reason.trim() === "" ||
                    confirmation.trim().toUpperCase() !== preview.mxeId
                  }
                  className="rounded-lg bg-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--white)] disabled:opacity-40"
                >
                  {pending ? "Reclaiming…" : `Delete ${preview.mxeId} and reclaim its badge`}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-5 rounded-lg bg-[var(--cream)] p-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Not reclaimable. Every check above has to pass — this vessel has a history, and its
              badge stays assigned to it.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
