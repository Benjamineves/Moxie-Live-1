/**
 * Shared constants and helpers for Ownership Transfer, used by both the
 * owner-side flow and the admin queue.
 */

import { BASIC_DOCUMENT_LIMIT } from "@/lib/tier-config";

export const TRANSFER_EXPIRY_DAYS = 7;

export type TransferStatus = "pending" | "awaiting_payment" | "completed" | "expired" | "canceled" | "reversed";

export const TRANSFER_STATUS_LABELS: Record<TransferStatus, string> = {
  pending: "Awaiting buyer acceptance",
  awaiting_payment: "Awaiting transfer fee payment",
  completed: "Completed",
  expired: "Expired",
  canceled: "Canceled",
  reversed: "Reversed",
};

/**
 * BASIC_DOCUMENT_LIMIT itself now lives in lib/tier-config.ts (the
 * single config location for all tier numbers) and is re-exported here
 * so existing imports from this module keep working.
 *
 * What it counts: doc_registration_url and doc_insurance_url — the two
 * document slots that exist on a vessel today. What's exempt, always,
 * regardless of tier: doc_boater_card_url (a personal operator
 * credential, not vessel equipment — same reasoning that keeps it from
 * transferring on ownership change) and photo_url (not a "document").
 * Full tier has no limit at all.
 *
 * Order matters when locking: registration counts first, insurance
 * second — a deterministic, stable choice so the same document doesn't
 * flip locked/unlocked between page loads.
 */
export { BASIC_DOCUMENT_LIMIT };

export type DocumentSlot = { docType: "registration" | "insurance"; url: string | null };

export function lockedDocumentCount(
  documents: DocumentSlot[],
  subscriptionTier: "basic" | "full",
): number {
  if (subscriptionTier === "full") return 0;
  const populated = documents.filter((d) => d.url).length;
  return Math.max(0, populated - BASIC_DOCUMENT_LIMIT);
}

/** Which of the ordered, populated document slots are locked under Basic. */
export function isDocumentLocked(
  documents: DocumentSlot[],
  index: number,
  subscriptionTier: "basic" | "full",
): boolean {
  if (subscriptionTier === "full") return false;
  const populatedBefore = documents.slice(0, index).filter((d) => d.url).length;
  return documents[index]?.url != null && populatedBefore >= BASIC_DOCUMENT_LIMIT;
}
