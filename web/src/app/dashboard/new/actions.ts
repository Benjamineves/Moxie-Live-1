"use server";

import { generateNextMxeId } from "@/lib/mxe-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type CreateVesselInput = {
  vessel_name: string;
  vessel_type: string;
  make: string;
  model: string;
  year: number;
  length_ft?: number | null;
  draft_ft?: number | null;
  public_notes?: string | null;
  photo_url?: string | null;
  doc_registration_url?: string | null;
  doc_insurance_url?: string | null;
};

function validate(input: CreateVesselInput) {
  if (!input.vessel_name.trim()) return "Vessel name is required.";
  if (!input.vessel_type.trim()) return "Vessel type is required.";
  if (!input.make.trim()) return "Make is required.";
  if (!input.model.trim()) return "Model is required.";
  if (!Number.isFinite(input.year) || input.year < 1900 || input.year > 2030) {
    return "Year must be between 1900 and 2030.";
  }
  return null;
}

export async function previewNextMxeId(): Promise<{ mxeId?: string; error?: string }> {
  try {
    const mxeId = await generateNextMxeId();
    return { mxeId };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unable to preview MXE ID." };
  }
}

export async function createVessel(
  input: CreateVesselInput,
  proposedMxeId?: string,
): Promise<{ mxeId?: string; error?: string }> {
  const basicError = validate(input);
  if (basicError) return { error: basicError };

  const authClient = await createSupabaseServerClient();
  if (!authClient) return { error: "Missing Supabase auth configuration." };

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const ownerEmail = user.email?.trim().toLowerCase();
  if (!ownerEmail) return { error: "Your account is missing an email address." };
  const fullNameFromEmail = ownerEmail.split("@")[0]?.replace(/[._-]+/g, " ").trim() || "Vessel Owner";
  const ownerName = fullNameFromEmail
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");

  const { data: existingOwnerByEmail } = await service
    .from("users")
    .select("id,full_name,email")
    .eq("email", ownerEmail)
    .maybeSingle();

  let ownerId = existingOwnerByEmail?.id ?? user.id;
  let ownerDisplayName = existingOwnerByEmail?.full_name?.trim() || ownerName;
  let ownerDisplayEmail = existingOwnerByEmail?.email?.trim().toLowerCase() || ownerEmail;

  if (!existingOwnerByEmail) {
    const { error: ownerError } = await service.from("users").upsert(
      {
        id: user.id,
        email: ownerEmail,
        full_name: ownerName,
        role: "owner",
      },
      { onConflict: "id" },
    );
    if (ownerError) {
      return { error: `Unable to initialize owner profile: ${ownerError.message}` };
    }
    ownerId = user.id;
    ownerDisplayName = ownerName;
    ownerDisplayEmail = ownerEmail;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const mxeId =
      attempt === 0 && proposedMxeId && /^MXE-\d{5}$/i.test(proposedMxeId)
        ? proposedMxeId.toUpperCase()
        : await generateNextMxeId();
    const { error } = await service.from("vessels").insert({
      owner_id: ownerId,
      mxe_id: mxeId,
      vessel_name: input.vessel_name.trim(),
      vessel_type: input.vessel_type.trim(),
      make: input.make.trim(),
      model: input.model.trim(),
      year: input.year,
      length_ft: input.length_ft ?? null,
      draft_ft: input.draft_ft ?? null,
      public_notes: input.public_notes?.trim() || null,
      photo_url: input.photo_url?.trim() || null,
      doc_registration_url: input.doc_registration_url?.trim() || null,
      doc_insurance_url: input.doc_insurance_url?.trim() || null,
      owner_name: ownerDisplayName,
      owner_email: ownerDisplayEmail,
    });

    if (!error) return { mxeId };
    if (!error.message.toLowerCase().includes("duplicate")) {
      return { error: error.message };
    }
  }

  return { error: "Could not reserve an MXE ID. Please try again." };
}
