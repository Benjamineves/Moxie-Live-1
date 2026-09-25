/**
 * Who may read a document out of a completed transfer's frozen snapshot, and
 * which stored path it is.
 *
 * The previously-owned page used to put the snapshot's raw storage path
 * ("{uid}/{MXE}/insurance.pdf") straight into an href. That is a relative
 * URL, so every "View →" opened a 404 — and even had it been absolute,
 * vessel-docs is private and nothing signed it. The page now links to
 * /api/transfers/[transferId]/documents/[docType], which asks this function
 * and then streams the file through a short-lived signed URL, the same way
 * the live documents route does.
 *
 * Only the SELLER, only once the transfer is completed (a reversed or
 * cancelled one never froze a record for them), and only a path the
 * snapshot actually holds. Pure, so the rule is tested without a database.
 */

export const SNAPSHOT_DOC_TYPES = ["registration", "insurance", "boater_card", "fishing_license"] as const;
export type SnapshotDocType = (typeof SNAPSHOT_DOC_TYPES)[number];

const SNAPSHOT_FIELD: Record<SnapshotDocType, string> = {
  registration: "doc_registration_url",
  insurance: "doc_insurance_url",
  boater_card: "doc_boater_card_url",
  fishing_license: "doc_fishing_license_url",
};

export type TransferForDocument = {
  seller_id: string;
  status: string;
  vessel_snapshot: Record<string, unknown> | null;
};

export type PreviouslyOwnedDocumentDecision =
  | { ok: true; path: string }
  | { ok: false; status: 400 | 403 | 404; error: string };

export function isSnapshotDocType(value: string): value is SnapshotDocType {
  return (SNAPSHOT_DOC_TYPES as readonly string[]).includes(value);
}

export function previouslyOwnedDocumentHref(transferId: string, docType: SnapshotDocType): string {
  return `/api/transfers/${encodeURIComponent(transferId)}/documents/${docType}`;
}

export function decidePreviouslyOwnedDocument(
  transfer: TransferForDocument | null,
  ownerIds: string[],
  docType: string,
): PreviouslyOwnedDocumentDecision {
  if (!isSnapshotDocType(docType)) return { ok: false, status: 400, error: "Invalid document type" };
  // Same 404 for "no such transfer" and "not yours", so the route can't be
  // used to learn which transfer ids exist.
  if (!transfer || !ownerIds.includes(transfer.seller_id)) {
    return { ok: false, status: 404, error: "Not found" };
  }
  if (transfer.status !== "completed" || !transfer.vessel_snapshot) {
    return { ok: false, status: 404, error: "Not found" };
  }
  const path = transfer.vessel_snapshot[SNAPSHOT_FIELD[docType]];
  if (typeof path !== "string" || path.trim() === "") {
    return { ok: false, status: 404, error: "No document on file." };
  }
  return { ok: true, path };
}
