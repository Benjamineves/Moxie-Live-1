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
 * Same bucket + path convention as VesselIntakeForm.tsx's photo upload —
 * shared here so AddPhotoNudge (first upload) and the owner-profile photo
 * replace control don't independently maintain their own copies of this.
 * upsert:true overwrites in place at the same deterministic path; nothing
 * about "replace" needs different logic from "add."
 */
export async function uploadVesselPhoto(file: File, mxeId: string): Promise<string> {
  const supabase = createSupabaseBrowserClient();
  if (!supabase) throw new Error("Missing Supabase browser configuration.");

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Please sign in again before uploading.");

  const ext = file.name.split(".").pop()?.toLowerCase() || (file.type.includes("png") ? "png" : "jpg");
  const path = `${user.id}/${mxeId}/photo.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from("vessel-photos")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw uploadError;

  const { data } = supabase.storage.from("vessel-photos").getPublicUrl(path);
  return data.publicUrl;
}

/** Document counterpart to uploadVesselPhoto — vessel-docs bucket is private, so the stored value is the path, not a public URL (matches VesselIntakeForm.tsx's doc upload). */
export async function uploadVesselDocument(file: File, mxeId: string, docType: DocType): Promise<string> {
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

  return path;
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
