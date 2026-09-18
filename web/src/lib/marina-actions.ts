"use server";

import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";
import {
  grantMarinaAccess,
  loadVesselMarinaAccess,
  revokeMarinaAccess,
  updateMarinaAccessDocuments,
  type GrantRefusal,
} from "@/lib/marina-access";

/**
 * The owner's three marina-access writes. docs/moxie_digital_marina_access_spec.md.
 *
 * Each proves the session owns the vessel the way every other owner action
 * does (resolveOwnerIds + loadOwnedVessel, which unions the placeholder
 * owner ids), then passes the vessel's OWN owner_id to the RPC. The RPCs
 * re-verify ownership, that the vessel is active and that the code
 * resolves — these checks are the courtesy, the SQL is the enforcement.
 *
 * Nothing here notifies the marina, in either direction (spec §2.5).
 */

type Result = { error?: string };

const GRANT_ERRORS: Record<GrantRefusal, string> = {
  unknown_code: "That code doesn't match a marina on Moxie.",
  not_owner: "Only the vessel's owner can share it with a marina.",
  vessel_not_eligible: "This vessel isn't active, so it can't be shared right now.",
};

async function ownedVessel(mxeId: string) {
  const authClient = await requireSupabaseServerClient("lib/marina-actions");
  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) return { error: "You must be signed in." } as const;
  const service = requireSupabaseServiceClient("lib/marina-actions");
  const vessel = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!vessel) return { error: "Vessel not found." } as const;
  return { service, vessel } as const;
}

export async function shareVesselWithMarina(
  joinCode: string,
  mxeId: string,
  shareRegistration: boolean,
  shareInsurance: boolean,
): Promise<Result & { created?: boolean }> {
  const owned = await ownedVessel(mxeId);
  if ("error" in owned) return { error: owned.error };
  const result = await grantMarinaAccess(owned.service, {
    ownerId: owned.vessel.owner_id,
    vesselId: owned.vessel.id,
    joinCode,
    share_registration: !!shareRegistration,
    share_insurance: !!shareInsurance,
  });
  if (!result.ok) return { error: GRANT_ERRORS[result.refusal] };
  return { created: result.created };
}

/** The grant must be on this vessel: an access id from another vessel is refused, not acted on. */
async function accessOnVessel(mxeId: string, accessId: string) {
  const owned = await ownedVessel(mxeId);
  if ("error" in owned) return { error: owned.error } as const;
  const grants = await loadVesselMarinaAccess(owned.service, [owned.vessel.id]);
  const grant = grants.find((g) => g.id === accessId);
  if (!grant) return { error: "That marina no longer has access." } as const;
  return { ...owned, grant } as const;
}

export async function changeMarinaAccessDocuments(
  mxeId: string,
  accessId: string,
  shareRegistration: boolean,
  shareInsurance: boolean,
): Promise<Result> {
  const found = await accessOnVessel(mxeId, accessId);
  if ("error" in found) return { error: found.error };
  const result = await updateMarinaAccessDocuments(found.service, {
    ownerId: found.vessel.owner_id,
    vesselId: found.vessel.id,
    marinaId: found.grant.marina_id,
    share_registration: !!shareRegistration,
    share_insurance: !!shareInsurance,
  });
  if (!result.ok) {
    return {
      error:
        result.refusal === "unknown_code"
          ? "This marina's code has been withdrawn, so its access can't be changed. You can still remove it."
          : GRANT_ERRORS[result.refusal],
    };
  }
  return {};
}

export async function revokeMarinaAccessForVessel(mxeId: string, accessId: string): Promise<Result> {
  const found = await accessOnVessel(mxeId, accessId);
  if ("error" in found) return { error: found.error };
  const result = await revokeMarinaAccess(found.service, { ownerId: found.vessel.owner_id, accessId });
  if (!result.ok) {
    return { error: result.refusal === "not_found" ? "That marina no longer has access." : "Only the vessel's owner can do that." };
  }
  return {};
}
