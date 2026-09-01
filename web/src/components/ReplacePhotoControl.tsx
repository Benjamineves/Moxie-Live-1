"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVesselPhoto } from "@/lib/vessel-uploads";
import { updateVesselPhoto } from "@/lib/owner-actions";

/**
 * Renders only when vessels.photo_url is already set — the replace
 * counterpart to AddPhotoNudge, which owns the "you don't have one yet"
 * framing (see VesselOwnerProfile.tsx for which one renders). Same upload
 * path via lib/vessel-uploads.ts; no "you don't have one yet" copy.
 */
export function ReplacePhotoControl({ mxeId }: { mxeId: string }) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFileSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setError("Photo must be an image file.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError("Max upload size is 10MB.");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const publicUrl = await uploadVesselPhoto(file, mxeId);
      const result = await updateVesselPhoto(mxeId, publicUrl);
      if (result.error) throw new Error(result.error);

      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div>
      <label className="inline-flex cursor-pointer items-center gap-1.5 font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--text3)] transition hover:text-[var(--gold)]">
        {uploading ? "Uploading…" : "Replace photo"}
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          onChange={(e) => onFileSelected(e.target.files)}
          className="hidden"
        />
      </label>
      {error ? (
        <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p>
      ) : null}
    </div>
  );
}
