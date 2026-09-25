"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { adminBackfillPatch } from "@/lib/storage-zip";

/**
 * Fill in the storage ZIP for a vessel that doesn't have one, from the
 * Missing ZIP list on /admin/geography. Same validation and county
 * derivation as the owner's Storage save (lib/storage-zip.ts).
 *
 * Only ever FILLS: the update is conditional on storage_zip still being
 * NULL, so a ZIP the owner saved since the page loaded is never replaced.
 * Not written to any audit log — there's no log for storage fields; the
 * row itself is the record.
 */
export async function backfillStorageZip(
  mxeId: string,
  zip: string,
  state: string | null,
): Promise<{ error?: string; county?: string }> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Admins only." };

  const service = requireSupabaseServiceClient("app/admin/geography/actions");
  const { data: row, error: readError } = await service
    .from("vessels")
    .select("id, storage_state, storage_zip")
    .eq("mxe_id", String(mxeId).toUpperCase())
    .maybeSingle();
  if (readError) return { error: readError.message };
  const vessel = row as { id: string; storage_state: string | null; storage_zip: string | null } | null;
  if (!vessel) return { error: "Vessel not found." };
  if (vessel.storage_zip) return { error: `Already has ZIP ${vessel.storage_zip} — reload the page.` };

  const patch = adminBackfillPatch(zip, vessel.storage_state, state);
  if (!patch.ok) return { error: patch.error };

  const { data: updated, error } = await service
    .from("vessels")
    .update(patch.set)
    .eq("id", vessel.id)
    .is("storage_zip", null)
    .select("id");
  if (error) return { error: error.message };
  if (!updated || updated.length === 0) return { error: "Its owner added a ZIP a moment ago — reload the page." };

  revalidatePath("/admin/geography");
  revalidatePath("/admin");
  return { county: patch.set.storage_county };
}
