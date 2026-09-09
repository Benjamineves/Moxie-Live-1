import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub";

/**
 * Removes the Storage objects belonging to a vessel that has just been
 * deleted (20260927).
 *
 * WHY THIS IS NOT INSIDE THE TRANSACTION
 *
 * A Storage delete is an external side effect and cannot join a Postgres
 * transaction. The order is deliberate: the database commits first, then
 * this runs. A deleted vessel with files left over is recoverable by
 * hand; files deleted from a vessel whose delete then failed is a live
 * record with missing documents.
 *
 * WHY IT RUNS AT ALL
 *
 * This branch fires on nearly every real reclaim, because intake uploads
 * happen before payment — so an abandoned checkout usually leaves a
 * photo and one or more documents behind. Those documents are the
 * customer's registration and insurance papers. Keeping them after
 * deleting their vessel is a data-retention problem, not merely orphaned
 * bytes.
 *
 * Lives here rather than inline in the admin action so it can be
 * exercised against a fixture. A branch that handles someone's insurance
 * document should not run for the first time against a real person's
 * files.
 */

export type VesselStorageRefs = {
  /** Public URL with a cache-bust token, as stored on vessels.photo_url. */
  photoUrl: string | null;
  /** Storage paths, as stored on the doc_*_url columns. */
  docPaths: (string | null)[];
};

export type CleanupOutcome = {
  removedDocs: string[];
  removedPhoto: string | null;
  /** Human-readable failures — anything here needs removing by hand. */
  leftovers: string[];
};

/**
 * Recovers the object key from a stored photo URL.
 *
 * photo_url is a full public URL carrying a ?v= cache-bust token
 * (vessel-uploads.ts), not a path, so the key has to be pulled back out
 * of it. Exported because this is the fiddly part and deserves its own
 * test rather than being trusted.
 */
export function photoObjectPath(photoUrl: string | null): string | null {
  if (!photoUrl) return null;
  const match = photoUrl.match(/\/vessel-photos\/(.+?)(\?|$)/);
  if (!match) return null;
  return decodeURIComponent(match[1]);
}

export async function cleanupVesselStorage(
  service: SupabaseClient<PermissiveDatabase>,
  refs: VesselStorageRefs,
): Promise<CleanupOutcome> {
  const outcome: CleanupOutcome = { removedDocs: [], removedPhoto: null, leftovers: [] };

  const docPaths = refs.docPaths.filter((p): p is string => !!p);
  if (docPaths.length > 0) {
    const { error } = await service.storage.from("vessel-docs").remove(docPaths);
    if (error) outcome.leftovers.push(`documents (${error.message})`);
    else outcome.removedDocs = docPaths;
  }

  if (refs.photoUrl) {
    const key = photoObjectPath(refs.photoUrl);
    if (!key) {
      // Deliberately reported rather than swallowed: a URL shape this
      // does not recognise means a photo is being left behind, and the
      // admin needs to know which vessel to go and tidy.
      outcome.leftovers.push("photo (could not derive object path from URL)");
    } else {
      const { error } = await service.storage.from("vessel-photos").remove([key]);
      if (error) outcome.leftovers.push(`photo (${error.message})`);
      else outcome.removedPhoto = key;
    }
  }

  return outcome;
}
