import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

export type DocType = "registration" | "insurance" | "boater_card";

const DOC_PATH_BASE: Record<DocType, string> = {
  registration: "registration",
  insurance: "insurance",
  boater_card: "boater_card",
};

function extFor(file: File) {
  const direct = file.name.split(".").pop()?.toLowerCase();
  if (direct) return direct;
  if (file.type.includes("png")) return "png";
  if (file.type.includes("jpeg")) return "jpg";
  if (file.type.includes("pdf")) return "pdf";
  return "bin";
}

/**
 * The single photo upload path — AddPhotoNudge (first upload),
 * ReplacePhotoControl, and VesselIntakeForm all route through here, so
 * the path convention and cache-busting live in exactly one place.
 *
 * Two things that look incidental and are not:
 *
 * 1. The path carries NO file extension. It used to: a JPEG landed at
 *    photo.jpg and a PNG at photo.png, so replacing a photo with a
 *    different format wrote a SECOND object instead of overwriting the
 *    first — orphaning bytes that nothing referenced any more, and
 *    making the "deterministic path" claim in this comment false. One
 *    extensionless object per vessel makes upsert actually upsert.
 *    Storage needs no extension to serve the file correctly; contentType
 *    below is what the browser reads.
 *
 * 2. The returned URL carries a ?v= token that changes on every upload.
 *    The object path is stable by design, which means without this the
 *    replacement is invisible: the service worker serves vessel photos
 *    cache-first (public/sw.js), and the browser and Supabase's CDN
 *    cache the same URL too, so a device that had already loaded the old
 *    photo would keep showing it indefinitely. Changing the URL misses
 *    all three caches at once. The caller persists the tokenized URL as
 *    photo_url, so the token is what makes the new photo reachable.
 */
export async function uploadVesselPhoto(file: File, mxeId: string): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Missing Supabase browser configuration.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again before uploading.");

  const path = `${user.id}/${mxeId}/photo`;

  const { error: uploadError } = await supabase.storage
    .from("vessel-photos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("vessel-photos").getPublicUrl(path);
  return withCacheBustToken(data.publicUrl);
}

/**
 * Appends a per-upload token. Timestamp-based rather than random so the
 * value is ordered and legible when reading a photo_url straight out of
 * the database — "which of these two is newer" is answerable by eye.
 * Storage ignores unrecognised query params; caches do not.
 */
function withCacheBustToken(publicUrl: string): string {
  const token = Date.now().toString(36);
  return `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}v=${token}`;
}

/**
 * Document counterpart to uploadVesselPhoto — vessel-docs bucket is private, so
 * the stored value is the path, not a public URL (matches VesselIntakeForm.tsx's
 * doc upload).
 *
 * Returns the original filename alongside the path because the path itself is
 * deterministic ({userId}/{mxeId}/registration.pdf) and therefore carries no
 * information — every vessel's registration document has the identical
 * basename. The caller persists fileName into the matching doc_*_filename
 * column (20260918_document_original_filenames.sql); it is the only point in
 * the system where the name the owner actually chose still exists.
 */
export async function uploadVesselDocument(
  file: File,
  mxeId: string,
  docType: DocType,
): Promise<{ path: string; fileName: string }> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Missing Supabase browser configuration.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again before uploading.");

  const ext = extFor(file);
  const path = `${user.id}/${mxeId}/${DOC_PATH_BASE[docType]}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("vessel-docs")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  return { path, fileName: file.name };
}

/**
 * Evidence attached to a locked-field correction request (see
 * owner-actions.ts's submitIdentityCorrectionRequest). Unlike
 * uploadVesselDocument, this deliberately does NOT use a fixed
 * deterministic path — each request is its own record an admin needs to
 * review, so a later request's evidence must not silently overwrite an
 * earlier pending one the way document "replace" intentionally does.
 */
export async function uploadCorrectionRequestDocument(file: File, mxeId: string): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Missing Supabase browser configuration.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again before uploading.");

  const ext = extFor(file);
  const path = `${user.id}/${mxeId}/correction-requests/${Date.now()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("vessel-docs")
    .upload(path, file, { contentType: file.type });
  if (uploadError) throw uploadError;

  return path;
}
