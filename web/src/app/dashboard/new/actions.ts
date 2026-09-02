"use server";

import { generateNextMxeId } from "@/lib/mxe-id";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isValidStateCode, normalizeStateCode } from "@/lib/us-states";
import { VESSEL_LIMIT, type SubscriptionTier } from "@/lib/tier-config";

const STORAGE_TYPES = ["marina", "mooring", "trailer", "home", "yard", "other"] as const;
export type StorageType = (typeof STORAGE_TYPES)[number];

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
  storage_type: StorageType;
  storage_state: string;
  storage_city?: string | null;
  storage_description?: string | null;
  marina_name?: string | null;
  marina_city?: string | null;
  slip_number?: string | null;
  marina_phone?: string | null;
  is_liveaboard?: boolean | null;
  slip_notes?: string | null;
};

function validate(input: CreateVesselInput) {
  if (!input.vessel_name.trim()) return "Vessel name is required.";
  if (!input.vessel_type.trim()) return "Vessel type is required.";
  if (!input.make.trim()) return "Make is required.";
  if (!input.model.trim()) return "Model is required.";
  if (!Number.isFinite(input.year) || input.year < 1900 || input.year > 2030) {
    return "Year must be between 1900 and 2030.";
  }
  if (!STORAGE_TYPES.includes(input.storage_type)) return "Invalid storage type.";
  // Storage state is the one new required field. Validated here as well
  // as in the form, against the shared 50-state + DC list, so a crafted
  // request can't write an arbitrary string into the column the
  // geographic dashboard reads.
  if (!input.storage_state?.trim()) return "Storage state is required.";
  if (!isValidStateCode(input.storage_state)) return "Invalid storage state.";
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
    .select("id,full_name,email,subscription_tier")
    .eq("email", ownerEmail)
    .maybeSingle();

  let ownerId = existingOwnerByEmail?.id ?? user.id;
  let ownerDisplayName = existingOwnerByEmail?.full_name?.trim() || ownerName;
  let ownerDisplayEmail = existingOwnerByEmail?.email?.trim().toLowerCase() || ownerEmail;
  // New owner rows default to subscription_tier='basic' at the DB level
  // (20260825_payment_storage_extensibility.sql) — same default applies
  // here before the upsert below runs.
  const ownerTier: SubscriptionTier = existingOwnerByEmail?.subscription_tier === "full" ? "full" : "basic";

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

  // Only vessels that both completed activation AND are still part of
  // the active fleet count against the cap. Two independent conditions,
  // deliberately not one: qr_status='active' excludes an abandoned/
  // never-paid registration (the scenario the dashboard's resume path
  // exists to fix — someone who abandons checkout twice shouldn't come
  // back to find their account artificially full of vessels that were
  // never real). lifecycle_status='active' excludes a decommissioned
  // vessel, which keeps whatever qr_status it already had — decommission
  // never touches qr_status — so qr_status alone can't tell a currently-
  // archived vessel apart from a real active one. This exact composite
  // filter is also what reactivate_vessel's cap check uses server-side
  // (20260906_vessel_decommission.sql) — the two must stay in sync.
  const vesselLimit = VESSEL_LIMIT[ownerTier];
  const { count: vesselCount, error: countError } = await service
    .from("vessels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("qr_status", "active")
    .eq("lifecycle_status", "active");
  if (countError) {
    return { error: `Unable to check vessel count: ${countError.message}` };
  }
  if ((vesselCount ?? 0) >= vesselLimit) {
    return { error: `You've reached the ${vesselLimit}-vessel limit on your current plan.` };
  }

  const isMarinaStorage = input.storage_type === "marina" || input.storage_type === "mooring";

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
      // marina_id is intentionally never set here — see the migration
      // comment on vessels.marina_name/marina_city. It's reserved for the
      // marina role's future create/match flow, not this self-serve funnel.
      storage_type: input.storage_type,
      // Structured location — captured for every storage type, not just
      // marina/mooring. New vessels populate these instead of the legacy
      // combined "City, ST" marina_city string, which stays in the
      // schema (and in the display fallback) only for rows that predate
      // this change.
      storage_state: normalizeStateCode(input.storage_state),
      storage_city: input.storage_city?.trim() || null,
      storage_description: isMarinaStorage ? null : input.storage_description?.trim() || null,
      marina_name: isMarinaStorage ? input.marina_name?.trim() || null : null,
      marina_city: isMarinaStorage ? input.marina_city?.trim() || null : null,
      slip_number: isMarinaStorage ? input.slip_number?.trim() || null : null,
      marina_phone: isMarinaStorage ? input.marina_phone?.trim() || null : null,
      is_liveaboard: isMarinaStorage ? input.is_liveaboard ?? null : null,
      slip_notes: isMarinaStorage ? input.slip_notes?.trim() || null : null,
    });

    if (!error) return { mxeId };
    if (!error.message.toLowerCase().includes("duplicate")) {
      return { error: error.message };
    }
  }

  return { error: "Could not reserve an MXE ID. Please try again." };
}
