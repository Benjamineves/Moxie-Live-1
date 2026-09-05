/**
 * The one place a vessel document's URL is built.
 *
 * The route itself takes no version — /api/vessels/[mxeId]/documents/
 * [docType] resolves the current file for that slot, and always has. The
 * token exists purely for cache identity: public/sw.js serves that route
 * cache-first out of a per-vessel cache, so on a vessel saved for offline
 * a replaced document would keep opening the old file indefinitely. That
 * is worse than it sounds now that documents carry expiry badges — a
 * stale PDF displayed under a current expiry date actively misinforms,
 * where no badge at all merely tells you nothing.
 *
 * uploadedAt comes from Storage's own updated_at on the stored bytes
 * (loadVesselDocumentMeta), which is exactly the property that changes
 * when, and only when, the file is replaced. So the token is derived
 * rather than generated: any two callers holding the same uploadedAt
 * produce the same URL without coordinating.
 *
 * That last property is the whole reason this is a shared helper and not
 * three string templates. The fetch in DocumentsEdit, the cache write in
 * saveVesselForOffline and the cache read in openOfflineDocument must
 * agree on the byte-for-byte URL. If they drift, an offline document
 * doesn't go stale — it becomes unreachable, which is the worse failure.
 *
 * A null uploadedAt (Storage listing degraded, or a document predating
 * this) yields the untokenized URL: the pre-existing behaviour, stale
 * risk included, rather than a new failure mode.
 */

/** Stable, order-preserving, short. Not a hash — being able to read the upload time back out of a cache key is useful when debugging. */
export function documentVersionToken(uploadedAt: string | null | undefined): string | null {
  if (!uploadedAt) return null;
  const parsed = Date.parse(uploadedAt);
  if (Number.isNaN(parsed)) {
    // An unparseable-but-present timestamp still distinguishes one
    // upload from the next, which is all the token has to do.
    const cleaned = uploadedAt.replace(/[^a-zA-Z0-9]/g, "");
    return cleaned || null;
  }
  return parsed.toString(36);
}

export function vesselDocumentUrl(
  mxeId: string,
  docType: string,
  uploadedAt: string | null | undefined,
): string {
  const base = `/api/vessels/${encodeURIComponent(mxeId)}/documents/${docType}`;
  const token = documentVersionToken(uploadedAt);
  return token ? `${base}?v=${token}` : base;
}
