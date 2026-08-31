"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { uploadVesselPhoto } from "@/lib/vessel-uploads";
import { updateVesselPhoto } from "@/lib/owner-actions";

/**
 * Renders only when vessels.photo_url is null (caller's responsibility —
 * see VesselOwnerProfile.tsx). Disappears permanently the moment photo_url
 * is set; no separate dismiss state needed since the condition IS the data.
 * Design: docs/design/moxie_digital_profile_owner.html, #photo-nudge.
 */
export function AddPhotoNudge({ mxeId, vesselName }: { mxeId: string; vesselName: string }) {
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
    <section className="mx-auto mt-6 max-w-lg rounded-xl bg-[var(--gold-dim)] p-5 md:mx-auto">
      <div className="flex items-center gap-3.5">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--gold-dim)]">
          <svg className="h-[18px] w-[18px] stroke-[var(--gold)]" viewBox="0 0 24 24" fill="none" strokeWidth={1.5}>
            <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
            <circle cx="12" cy="13" r="4" />
          </svg>
        </div>
        <div className="flex-1">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
            Add a photo of {vesselName}
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            Takes 30 seconds — replaces the default background on your public profile
          </p>
        </div>
        <label className="shrink-0 cursor-pointer rounded-md bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gold)]">
          {uploading ? "Uploading…" : "Add"}
          <input
            type="file"
            accept="image/*"
            disabled={uploading}
            onChange={(e) => onFileSelected(e.target.files)}
            className="hidden"
          />
        </label>
      </div>
      {error ? (
        <p className="mt-3 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p>
      ) : null}
    </section>
  );
}
