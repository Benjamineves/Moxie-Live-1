"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { initiateOwnershipTransfer, cancelOwnershipTransfer } from "@/lib/owner-actions";
import {
  editTriggerOnDarkClass,
  inputClass,
  labelClass,
  saveButtonClass,
  cancelButtonClass,
  onDarkPrimaryButtonClass,
  onDarkDangerButtonClass,
} from "./formStyles";
import { CancelTransferDialog } from "./CancelTransferDialog";

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
  // Whether the buyer's invitation actually went out. The confirmation
  // screen leads with the email, so it has to know rather than assume:
  // the send is best-effort and a provider outage does not fail the
  // transfer. When it is false the seller IS the delivery mechanism
  // again, and has to be told so.
  const [emailed, setEmailed] = useState(true);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

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
      setEmailed(result.emailed !== false);
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
      setConfirmingCancel(false);
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
      setEmailed(result.emailed !== false);
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
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--white)]">
              Waiting for {activeTransfer.buyerEmail} to accept.
            </p>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.7)]">
              {daysLeft > 0 ? `Expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.` : "Expires today."} Nothing is
              charged until they accept and you complete payment.
            </p>
          </>
        ) : (
          <>
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--white)]">
              {activeTransfer.buyerEmail} accepted — pay the transfer fee to finish.
            </p>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.7)]">
              Ownership moves the moment this clears.
            </p>
          </>
        )}
        {/* --red-fg measures 1.48:1 here. An error a seller cannot read
            is an error that did not happen, as far as they know. */}
        {error ? (
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--danger-on-dark)]">{error}</p>
        ) : null}

        {/* Primary first and filled; cancel last, outlined, and warm red.
            These were peers in the same class until a seller cancelled a
            live sale by clicking the one they could not read. Resending
            an email is repeatable; cancelling ends a sale and tells the
            buyer it is off. They should not look alike. */}
        <div className="mt-3 flex flex-wrap items-center gap-2.5">
          {activeTransfer.status === "awaiting_payment" ? (
            <Link
              href={`/dashboard/transfer/${encodeURIComponent(activeTransfer.id)}/payment`}
              className={onDarkPrimaryButtonClass}
            >
              Pay transfer fee
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => onResend(activeTransfer.id, activeTransfer.buyerEmail)}
              disabled={pending}
              className={onDarkPrimaryButtonClass}
            >
              Email a new link
            </button>
          )}
          <button
            type="button"
            onClick={() => setConfirmingCancel(true)}
            disabled={pending}
            className={onDarkDangerButtonClass}
          >
            {pending ? "Working…" : "Cancel transfer"}
          </button>
        </div>

        <CancelTransferDialog
          open={confirmingCancel}
          buyerEmail={activeTransfer.buyerEmail}
          pending={pending}
          onConfirm={() => onCancel(activeTransfer.id)}
          onDismiss={() => setConfirmingCancel(false)}
        />
      </div>
    );
  }

  if (generatedLink) {
    return (
      <div className="mx-auto mt-3 max-w-lg rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
        {/* Moxie emails the buyer on initiation (see
            createTransferAndNotifyBuyer), so the email is the primary
            fact and the link below is the fallback — for a seller who
            would rather send it themselves, or a buyer it never reached.
            This screen used to read "Send this link to…", which was
            true only while the seller WAS the delivery mechanism.

            The send is best effort, so `emailed` is the real result and
            not an assumption. When it is false the seller is the only
            route left and the copy has to say so plainly, not bury it. */}
        {emailed ? (
          <>
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
              We&apos;ve emailed the transfer link to {buyerEmail}
            </p>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
              Only they can accept it — the link is locked to that email, so there&apos;s no harm in it going astray.
              There&apos;s nothing else you need to do. If you&apos;d rather send it yourself, or it doesn&apos;t
              arrive, here it is:
            </p>
          </>
        ) : (
          <>
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
              The transfer is live, but we couldn&apos;t email {buyerEmail}
            </p>
            {/* --text2, not the --text3 used for the reassuring branch
                above. That one says "nothing else to do"; this one is an
                instruction the transfer depends on, and it is the only
                place the seller will ever be told. Copy it before you
                leave — the old "shown once" warning was dropped for the
                success case, where losing the link is harmless because
                the buyer already has it, but here it is the whole
                delivery mechanism. */}
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
              Nothing is wrong with the transfer itself — only the message failed to go out, so you&apos;ll need to
              send this link yourself. Copy it before you leave this screen; it isn&apos;t shown again. Only{" "}
              {buyerEmail} can accept it, so the link is safe to send however you like.
            </p>
          </>
        )}
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
      // This trigger renders inside the navy-deep "Transfer ownership"
      // card in VesselOwnerProfile, not on a white one — so it keeps
      // --gold, which is correct there, while every other edit trigger
      // in the app moved to --gold-deep for its light card.
      <button type="button" onClick={() => setOpen(true)} className={editTriggerOnDarkClass}>
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
      {/* Said before the address is submitted, not after. We email a
          person who never signed up, on the strength of this seller
          typing their address — they should know that is what the button
          does before they press it. */}
      <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
        Moxie emails the buyer directly with a link to accept — a message from us is easier for them to trust than a
        link forwarded by someone they&apos;re mid-sale with. You&apos;ll get the link too, in case you&apos;d rather
        send it yourself.
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
          {pending ? "Emailing the buyer…" : "Start transfer & email buyer"}
        </button>
      </div>
    </div>
  );
}
