"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { isValidStateCode, normalizeStateCode } from "@/lib/us-states";
import { VESSEL_LIMIT, type SubscriptionTier } from "@/lib/tier-config";
import { isAdminEmail } from "@/lib/admin-verify";

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
  /** Original upload names (20260918_document_original_filenames.sql) — display only, null when not captured. */
  doc_registration_filename?: string | null;
  doc_insurance_filename?: string | null;
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

/**
 * previewNextMxeId used to live here. It burned a sequence value to show
 * the customer their MXE ID on the review screen, before the vessel
 * existed — and stage 7 makes that unworkable: the ID now comes from the
 * badge pool at insert time, so a previewed sequence value would be a
 * different number from the one the vessel actually gets. Spec §4.1 is
 * emphatic that the MXE ID is a fixed fact from the moment it is shown,
 * so it is now shown after creation rather than guessed before it.
 */
export async function createVessel(
  input: CreateVesselInput,
): Promise<{ mxeId?: string; error?: string; code?: "VESSEL_CAP_REACHED" }> {
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
  // Admin accounts (ADMIN_EMAILS) bypass the cap entirely — internal-only
  // exemption to unblock testing, deliberately not a new tier. A real
  // dealer/broker tier with its own higher cap is a separate decision for
  // later, not something this should be mistaken for.
  const capExempt = isAdminEmail(ownerDisplayEmail);
  const { count: vesselCount, error: countError } = await service
    .from("vessels")
    .select("id", { count: "exact", head: true })
    .eq("owner_id", ownerId)
    .eq("qr_status", "active")
    .eq("lifecycle_status", "active");
  if (countError) {
    return { error: `Unable to check vessel count: ${countError.message}` };
  }
  if (!capExempt && (vesselCount ?? 0) >= vesselLimit) {
    return {
      error: `You've reached the ${vesselLimit}-vessel limit on your current plan.`,
      // Only actionable for Basic — Full is already the highest tier
      // today, so there's no in-app upgrade to point to for that case.
      ...(ownerTier === "basic" ? { code: "VESSEL_CAP_REACHED" as const } : {}),
    };
  }

  const isMarinaStorage = input.storage_type === "marina" || input.storage_type === "mooring";

  // The MXE ID and the badge are decided inside create_vessel_with_badge
  // (20260926), not here, so neither appears in this payload. The
  // three-attempt retry loop that used to wrap this insert is gone with
  // them: it existed only because a previewed ID could be taken by a
  // concurrent signup between preview and insert. A pool claim uses FOR
  // UPDATE SKIP LOCKED and next_mxe_id() draws from a sequence, so
  // neither source can hand out the same ID twice and there is nothing
  // left for a retry to fix. A duplicate now would mean something is
  // genuinely wrong and should surface, not be swallowed and retried.
  const { data, error } = await service.rpc("create_vessel_with_badge", {
    p_vessel: {
      owner_id: ownerId,
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
      doc_registration_filename: input.doc_registration_filename?.trim() || null,
      doc_insurance_filename: input.doc_insurance_filename?.trim() || null,
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
    },
  });

  if (error) return { error: error.message };

  const result = data as { mxe_id?: string; from_pool?: boolean } | null;
  if (!result?.mxe_id) {
    return { error: "Vessel was created but no MXE ID came back. Contact support before paying." };
  }

  // §3.2's fallback is deliberately loud rather than silent — if stock
  // ran out, the vessel has badge_identity_id NULL and its badge has to
  // be printed individually. Logged here so it is visible in the
  // deployment logs from the first occurrence, before the queue flag and
  // the low-water alarm exist (7b).
  if (!result.from_pool) {
    console.warn(
      `[badge-pool] ${result.mxe_id} was minted on demand — the in_stock pool was empty. This badge must be printed individually.`,
    );
  }

  return { mxeId: result.mxe_id };
}
