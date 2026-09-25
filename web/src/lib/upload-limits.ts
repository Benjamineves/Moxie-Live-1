/**
 * What an upload may be. The storage buckets enforce the same list and size
 * (20261012_storage_bucket_limits_and_photo_policies.sql sets
 * allowed_mime_types and file_size_limit); the forms use these for their
 * `accept` attribute and lib/vessel-uploads.ts checks them first, so a
 * refused file gets a readable message rather than Storage's error.
 * upload-limits.test.mts fails if the migration's literals drift from these.
 *
 * Explicit types, not `image/*`: that wildcard admits image/svg+xml, which
 * can carry script and is served from a public bucket. HEIC/HEIF stay
 * allowed because the forms have always taken them (iPhone files picked
 * outside Safari arrive as HEIC).
 */

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export const PHOTO_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

export const DOCUMENT_MIME_TYPES = ["application/pdf", ...PHOTO_MIME_TYPES] as const;

export const PHOTO_ACCEPT = PHOTO_MIME_TYPES.join(",");
export const DOCUMENT_ACCEPT = DOCUMENT_MIME_TYPES.join(",");

/** null when the file may be uploaded, otherwise the message to show. */
export function uploadRefusal(file: { type: string; size: number }, kind: "photo" | "document"): string | null {
  const allowed: readonly string[] = kind === "photo" ? PHOTO_MIME_TYPES : DOCUMENT_MIME_TYPES;
  if (!file.type) return "Couldn't tell what kind of file this is. Try saving it as a JPEG, PNG or PDF.";
  if (!allowed.includes(file.type)) {
    return kind === "photo"
      ? "Photos must be JPEG, PNG, WebP or HEIC."
      : "Documents must be a PDF, or a JPEG, PNG, WebP or HEIC image.";
  }
  if (file.size > MAX_UPLOAD_BYTES) return "Max upload size is 10MB.";
  return null;
}
