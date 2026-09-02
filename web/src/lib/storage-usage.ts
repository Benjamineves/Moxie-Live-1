import type { createSupabaseServiceClient } from "@/lib/supabase/service";

type ServiceClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

/**
 * The two buckets that count toward FULL_STORAGE_CAP_BYTES
 * (lib/tier-config.ts). Deliberately excludes
 * vessel-docs/<owner>/<mxeId>/correction-requests/ — that's admin-review
 * evidence for a locked-field fix request, not a "document" or "photo" in
 * the tier-limits sense, and isn't part of what a Full-tier owner thinks
 * of as their storage.
 */
const BUCKETS = ["vessel-photos", "vessel-docs"] as const;

/**
 * Sums the size of every file directly under <ownerId>/<mxeId>/ across
 * both storage buckets, for every (ownerId, mxeId) pair passed in.
 *
 * Takes a list of owner id prefixes rather than a single id because
 * upload paths (lib/vessel-uploads.ts) are namespaced by the uploading
 * browser session's auth.uid(), which isn't always the same id as
 * users.id/vessels.owner_id — the same account can be reached under two
 * different auth ids that share one email (see resolveOwnerIds). Pass
 * every id resolveOwnerIds returned so usage under either prefix counts.
 */
export async function getAccountStorageUsageBytes(
  service: ServiceClient,
  ownerIds: string[],
  mxeIds: string[],
): Promise<number> {
  let total = 0;

  for (const ownerId of ownerIds) {
    for (const mxeId of mxeIds) {
      const folder = `${ownerId}/${mxeId}`;
      for (const bucket of BUCKETS) {
        const { data } = await service.storage.from(bucket).list(folder);
        if (!data) continue;
        for (const entry of data) {
          const size = (entry.metadata as { size?: number } | null)?.size;
          if (typeof size === "number") total += size;
        }
      }
    }
  }

  return total;
}
