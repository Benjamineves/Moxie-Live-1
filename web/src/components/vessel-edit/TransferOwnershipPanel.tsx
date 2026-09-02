"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { initiateOwnershipTransfer, cancelOwnershipTransfer } from "@/lib/owner-actions";
import { editTriggerClass, inputClass, labelClass, saveButtonClass, cancelButtonClass } from "./formStyles";

export type ActiveTransfer = {
  id: string;
  status: "pending" | "awaiting_payment";
  buyerEmail: string;
  expiresAt: string;
};

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

export function TransferOwnershipPanel({ mxeId, activeTransfer }: { mxeId: string; activeTransfer: ActiveTransfer | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [buyerEmail, setBuyerEmail] = useState("");
  const [generatedLink, setGeneratedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  async function copyToClipboard(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy — select and copy the link manually.");
    }
  }

  function onInitiate() {
    setError(null);
    startTransition(async () => {
      const result = await initiateOwnershipTransfer(mxeId, buyerEmail);
      if (result.error || !result.token) {
        setError(result.error ?? "Could not start the transfer.");
        return;
      }
      setGeneratedLink(`${window.location.origin}/transfer/accept?token=${result.token}`);
    });
  }

  function onCancel(transferId: string) {
    setError(null);
    startTransition(async () => {
      const result = await cancelOwnershipTransfer(transferId);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  function onResend(transferId: string, email: string) {
    setError(null);
    startTransition(async () => {
      const cancelResult = await cancelOwnershipTransfer(transferId);
      if (cancelResult.error) {
        setError(cancelResult.error);
        return;
      }
      const result = await initiateOwnershipTransfer(mxeId, email);
      if (result.error || !result.token) {
        setError(result.error ?? "Could not resend the transfer.");
        return;
      }
      setOpen(true);
      setBuyerEmail(email);
      setGeneratedLink(`${window.location.origin}/transfer/accept?token=${result.token}`);
    });
  }

  // A transfer already in progress — show its status instead of the
  // "start a new one" trigger. Only one active transfer per vessel is
  // allowed (enforced server-side in initiateOwnershipTransfer too).
  if (activeTransfer && !generatedLink) {
    const daysLeft = daysUntil(activeTransfer.expiresAt);
    return (
      <div className="mx-auto mt-3 max-w-lg rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] p-5 shadow-sm">
        {activeTransfer.status === "pending" ? (
          <>
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
              Waiting for {activeTransfer.buyerEmail} to accept.
            </p>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
              {daysLeft > 0 ? `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` : "Expires today."} Nothing is
              charged until they accept and you complete payment.
            </p>
          </>
        ) : (
          <>
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
              {activeTransfer.buyerEmail} accepted — pay the transfer fee to finish.
            </p>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
              Ownership moves the moment this clears.
            </p>
          </>
        )}
        {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
        <div className="mt-3 flex flex-wrap gap-2.5">
          {activeTransfer.status === "awaiting_payment" ? (
            <Link
              href={`/dashboard/transfer/${encodeURIComponent(activeTransfer.id)}/payment`}
              className={saveButtonClass}
            >
              Pay transfer fee
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onResend(activeTransfer.id, activeTransfer.buyerEmail)}
              disabled={pending}
              className={cancelButtonClass}
            >
              Resend link
            </button>
          )}
          <button
            type="button"
            onClick={() => onCancel(activeTransfer.id)}
            disabled={pending}
            className={cancelButtonClass}
          >
            {pending ? "Working…" : "Cancel transfer"}
          </button>
        </div>
      </div>
    );
  }

  if (generatedLink) {
    return (
      <div className="mx-auto mt-3 max-w-lg rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
        <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
          Send this link to {buyerEmail}
        </p>
        <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          Only they can accept it — the link is locked to that email. This is shown once; you can resend a fresh one
          later if needed.
        </p>
        <p className="mt-3 break-all rounded-lg border border-[var(--divider)] bg-[var(--cream)] px-3 py-2.5 font-mono text-xs text-[var(--navy)]">
          {generatedLink}
        </p>
        {error ? <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
        <div className="mt-3 flex gap-2.5">
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setGeneratedLink(null);
              router.refresh();
            }}
            className={cancelButtonClass}
          >
            Done
          </button>
          <button type="button" onClick={() => copyToClipboard(generatedLink)} className={saveButtonClass}>
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={editTriggerClass}>
        Selling? Transfer ownership to a new owner
      </button>
    );
  }

  return (
    <div className="mx-auto mt-3 max-w-lg grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
        The vessel&apos;s identity, title history, and USCG documentation transfer with it. Your own contact info,
        storage details, and documents (insurance, boater card) stay yours and stop showing on this vessel once
        transferred. You&apos;ll pay the transfer fee once the buyer accepts — nothing is charged now.
      </p>
      <label className={labelClass}>
        Buyer&apos;s email
        <input
          type="email"
          className={inputClass}
          value={buyerEmail}
          onChange={(e) => setBuyerEmail(e.target.value)}
          placeholder="buyer@example.com"
        />
      </label>
      {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <div className="flex gap-2.5">
        <button type="button" onClick={() => setOpen(false)} disabled={pending} className={cancelButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={onInitiate} disabled={pending} className={saveButtonClass}>
          {pending ? "Creating link…" : "Create transfer link"}
        </button>
      </div>
    </div>
  );
}
