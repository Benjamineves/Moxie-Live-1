"use client";

import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * The one confirmation for cancelling a transfer, shared by the vessel
 * panel and the payment screen so both say the same thing.
 *
 * Cancelling is not the same kind of act as the neutral controls beside
 * it. It ends a sale that is already in motion, it emails the buyer to
 * say so, and it cannot be undone — a new transfer means a new link the
 * buyer has to accept again. So the dialog names the buyer, says they
 * will be told, and labels its buttons with what they do rather than
 * "OK" and "Cancel".
 */
export function CancelTransferDialog({
  open,
  buyerEmail,
  pending,
  onConfirm,
  onDismiss,
}: {
  open: boolean;
  buyerEmail: string;
  pending: boolean;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      title="Cancel this transfer?"
      pending={pending}
      destructive
      confirmLabel="Cancel the transfer"
      pendingLabel="Cancelling…"
      onConfirm={onConfirm}
      onCancel={onDismiss}
    >
      <p className="font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
        <span className="font-medium text-[var(--navy)]">{buyerEmail}</span> will be emailed to say the transfer was
        cancelled, and their link will stop working.
      </p>
      <p className="mt-2 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
        This can&apos;t be undone. If you change your mind you can start a new transfer, but it sends a new link that
        they have to accept again.
      </p>
    </ConfirmDialog>
  );
}
