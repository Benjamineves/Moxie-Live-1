import { requireSupabaseServiceClient } from "./supabase/service.ts";

/**
 * Resolve a vessel owner's email for permission checks.
 *
 * Service role only, through the shared helper, so a missing key is a 500.
 * This used to build its own client and, on any failure, fall back to the
 * anon key — which RLS gave zero rows (and, since 20261013, no grant at
 * all) — returning null. Callers read null as "not the owner", so a broken
 * deploy told real owners "Forbidden — sign in as the vessel owner": a
 * configuration fault reported as a fact about the visitor.
 *
 * A query error still yields null (the caller's refusal), but is logged.
 */
export async function getOwnerEmailByUserId(ownerId: string): Promise<string | null> {
  const service = requireSupabaseServiceClient("lib/owner-verify");
  const { data, error } = await service.from("users").select("email").eq("id", ownerId).maybeSingle();
  if (error) {
    console.error(`[owner-verify] users read failed for ${ownerId}: ${error.message}`);
    return null;
  }
  return (data as { email: string | null } | null)?.email ?? null;
}

export function emailsMatch(a: string | undefined | null, b: string | undefined | null) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
