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

/** The two buckets a vessel's uploads can live in (see vessel-uploads.ts). */
const UPLOAD_BUCKETS = ["vessel-photos", "vessel-docs"] as const;

/**
 * Removes everything left under a vessel's upload prefix, `{ownerId}/{mxeId}`,
 * in both buckets — run after cleanupVesselStorage.
 *
 * WHY BOTH. cleanupVesselStorage removes the objects the vessel row still
 * points at, which is all the admin reclaim ever did. The owner delete did
 * this instead: a sweep of the whole prefix, which also catches files the
 * row no longer references (a replaced document, an attachment in a
 * subfolder). Now that both go through one helper, both get both, so
 * neither path loses the thoroughness it had.
 *
 * Safe against MXE ID reuse: a reclaimed identity can be assigned to a new
 * vessel later, but that vessel's files live under ITS owner's id, so
 * this prefix only ever reaches the deleted vessel's files.
 *
 * One level of subfolder is as deep as the upload convention nests.
 */
export async function sweepVesselStoragePrefix(
  service: SupabaseClient<PermissiveDatabase>,
  ownerId: string,
  mxeId: string,
): Promise<{ removed: string[]; leftovers: string[] }> {
  const prefix = `${ownerId}/${mxeId}`;
  const out = { removed: [] as string[], leftovers: [] as string[] };

  for (const bucket of UPLOAD_BUCKETS) {
    const paths: string[] = [];
    const { data: entries, error: listError } = await service.storage.from(bucket).list(prefix, { limit: 1000 });
    if (listError) {
      out.leftovers.push(`${bucket}/${prefix} (could not list: ${listError.message})`);
      continue;
    }
    for (const entry of entries ?? []) {
      if (entry.id === null) {
        const { data: nested, error: nestedError } = await service.storage
          .from(bucket)
          .list(`${prefix}/${entry.name}`, { limit: 1000 });
        if (nestedError) {
          out.leftovers.push(`${bucket}/${prefix}/${entry.name} (could not list: ${nestedError.message})`);
          continue;
        }
        for (const file of nested ?? []) {
          if (file.id !== null) paths.push(`${prefix}/${entry.name}/${file.name}`);
        }
      } else {
        paths.push(`${prefix}/${entry.name}`);
      }
    }
    if (paths.length === 0) continue;
    const { error: removeError } = await service.storage.from(bucket).remove(paths);
    if (removeError) out.leftovers.push(`${bucket}: ${paths.length} file(s) (${removeError.message})`);
    else out.removed.push(...paths.map((p) => `${bucket}/${p}`));
  }

  return out;
}
