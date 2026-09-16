"use server";

import { revalidatePath } from "next/cache";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import { validateServiceRecord, tierAllowsServiceRecords } from "@/lib/service-records";
import {
  deleteServiceRecord,
  insertServiceRecord,
  loadServiceRecord,
  updateServiceRecord,
} from "@/lib/service-records-store";

/**
 * Service-record writes. Full Access only, owner only.
 *
 * Both checks are re-verified here on every call rather than trusted from
 * the page that rendered the form: a server action receives whatever
 * arguments a client sends, and a page restricting the choices it offers
 * is not authorization (CLAUDE.md).
 *
 * What is NOT here: any way to set or move logged_at. The column has no
 * path through these actions, and the database would refuse anyway — a
 * BEFORE UPDATE trigger restores the old value for every role. That is
 * deliberate belt-and-braces: the credibility of the whole feature rests
 * on that one value being outside the owner's reach, so it does not depend
 * on this file staying careful.
 */

type Ctx = { vesselId: string; ownerId: string } | { error: string };

async function ownedFullAccessVessel(mxeId: string): Promise<Ctx> {
  const authClient = await requireSupabaseServerClient("dashboard/[mxeId]/service/actions");
  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." };

  const service = requireSupabaseServiceClient("dashboard/[mxeId]/service/actions");
  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as { id: string; owner_id: string } | null;
  if (!vessel || !ownerIds.includes(vessel.owner_id)) return { error: "Vessel not found." };

  const { data: ownerRow } = await service
    .from("users")
    .select("subscription_tier")
    .eq("id", vessel.owner_id)
    .maybeSingle();
  const tier = (ownerRow as { subscription_tier: string | null } | null)?.subscription_tier ?? "basic";
  if (!tierAllowsServiceRecords(tier)) {
    return { error: "Service records are part of Full Access." };
  }

  return { vesselId: vessel.id, ownerId: user.id };
}

export async function addServiceRecord(
  mxeId: string,
  input: { serviceDate: string; category: string; description: string; provider?: string | null; file?: { path: string; name: string; sizeBytes: number | null } | null },
): Promise<{ error?: string }> {
  const ctx = await ownedFullAccessVessel(mxeId);
  if ("error" in ctx) return { error: ctx.error };

  const checked = validateServiceRecord(input, new Date());
  if (!checked.ok) return { error: checked.error };

  const service = requireSupabaseServiceClient("dashboard/[mxeId]/service/actions add");
  const result = await insertServiceRecord(service, {
    vesselId: ctx.vesselId,
    loggedBy: ctx.ownerId,
    serviceDate: checked.value.serviceDate,
    category: checked.value.category,
    description: checked.value.description,
    provider: checked.value.provider,
    file: input.file ?? null,
  });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/dashboard/${mxeId}/service`);
  return {};
}

export async function editServiceRecord(
  mxeId: string,
  id: string,
  input: { serviceDate: string; category: string; description: string; provider?: string | null },
): Promise<{ error?: string }> {
  const ctx = await ownedFullAccessVessel(mxeId);
  if ("error" in ctx) return { error: ctx.error };

  const checked = validateServiceRecord(input, new Date());
  if (!checked.ok) return { error: checked.error };

  const service = requireSupabaseServiceClient("dashboard/[mxeId]/service/actions edit");
  const existing = await loadServiceRecord(service, id, ctx.vesselId);
  if (!existing) return { error: "That entry no longer exists." };

  const result = await updateServiceRecord(service, id, ctx.vesselId, {
    serviceDate: checked.value.serviceDate,
    category: checked.value.category,
    description: checked.value.description,
    provider: checked.value.provider,
  });
  if ("error" in result) return { error: result.error };

  revalidatePath(`/dashboard/${mxeId}/service`);
  return {};
}

/**
 * Deletes the entry. The attached file is deliberately LEFT IN STORAGE —
 * see the report and the roadmap. Removing it would be the one destructive
 * side effect in this feature, and it is not obvious that a deleted entry
 * means a discarded invoice; the file still counts against the owner's
 * storage cap, so it is visible rather than orphaned silently.
 */
export async function removeServiceRecord(mxeId: string, id: string): Promise<{ error?: string }> {
  const ctx = await ownedFullAccessVessel(mxeId);
  if ("error" in ctx) return { error: ctx.error };

  const service = requireSupabaseServiceClient("dashboard/[mxeId]/service/actions remove");
  const result = await deleteServiceRecord(service, id, ctx.vesselId);
  if ("error" in result) return { error: result.error };

  revalidatePath(`/dashboard/${mxeId}/service`);
  return {};
}
