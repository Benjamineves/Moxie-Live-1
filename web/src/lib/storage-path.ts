/**
 * Whether a storage reference sent by a client belongs to the caller.
 *
 * The documents and service-record routes sign whatever path is stored on a
 * row, with the service role, so the bucket's own-folder policies never see
 * those reads. That makes the WRITE the only place a path can be checked:
 * every server action that stores a client-supplied path or photo URL must
 * pass it through here first. storage-path.test.mts fails if one doesn't.
 *
 * Uploads always land under the uploader's auth id
 * (lib/vessel-uploads.ts: `${user.id}/...`), so "starts with my auth id" is
 * exactly the set of files the caller could have uploaded. A registration
 * document that carried over on a transfer stays in the seller's folder,
 * but it is kept by the server, never re-sent by the buyer, so it never
 * comes through here.
 */

// Any printable text but a separator. Not a tight character class: extFor()
// in vessel-uploads.ts uses a whole dotless filename as the "extension", so
// legitimate paths can carry spaces. `%` is refused outright (above) so an
// encoded `..` can't be decoded into traversal further down the line.
const SEGMENT = /^[^/\\\u0000-\u001f\u007f]+$/;

/** A bucket-relative path inside `userId`'s own folder, with no traversal. */
export function isOwnStoragePath(path: unknown, userId: string): path is string {
  if (typeof path !== "string" || !userId) return false;
  if (path.length > 512 || path.includes("\\") || path.includes("%")) return false;
  const segments = path.split("/");
  if (segments.length < 2 || segments[0] !== userId) return false;
  return segments.every((s) => s !== "" && s !== "." && s !== ".." && SEGMENT.test(s));
}

/**
 * A public vessel-photos URL for an object in `userId`'s own folder, as
 * uploadVesselPhoto returns it (optionally with its `?v=` cache token).
 */
export function isOwnPhotoUrl(url: unknown, userId: string, supabaseUrl: string | undefined): url is string {
  if (typeof url !== "string" || !supabaseUrl) return false;
  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(url);
    base = new URL(supabaseUrl);
  } catch {
    return false;
  }
  if (parsed.origin !== base.origin || parsed.username || parsed.password || parsed.hash) return false;
  const prefix = "/storage/v1/object/public/vessel-photos/";
  if (!parsed.pathname.startsWith(prefix)) return false;
  const extraParams = [...parsed.searchParams.keys()].filter((k) => k !== "v");
  if (extraParams.length > 0) return false;
  return isOwnStoragePath(parsed.pathname.slice(prefix.length), userId);
}

export const FOREIGN_PATH_ERROR = "That file isn't one you uploaded. Upload it again and retry.";
