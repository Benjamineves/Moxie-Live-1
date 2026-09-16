import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { hashShareToken } from "@/lib/share-token";
import { checkRateLimit } from "@/lib/rate-limit";
import { filterVesselForShare, isShareFieldFlags, shareShowsService } from "@/lib/share-filter";
import { loadServiceRecords, withoutFilePaths } from "@/lib/service-records-store";
import type { ServiceRecord } from "@/lib/service-records";
import type { VesselRecord } from "@/types/vessel";

type ShareRow = {
  vessel_id: string;
  label: string | null;
  field_flags: unknown;
  access_note: string | null;
  expires_at: string | null;
};

export type ResolvedShare = {
  vessel: ReturnType<typeof filterVesselForShare>;
  sharedBy: string | null;
  label: string | null;
  expiresAt: string | null;
  /** Empty unless the link's `service` flag is on. Never carries file paths. */
  serviceRecords: ServiceRecord[];
};

/**
 * Shared by the public API route (spec §5, GET /api/share/:token) and
 * the recipient page's own server-side render (spec §7, so the page
 * doesn't self-fetch its own API over HTTP) — one implementation, one
 * place the atomic-resolve/rate-limit/field-filter logic lives.
 */
export async function resolveShareByToken(token: string, clientIp: string): Promise<{ error: string } | ResolvedShare> {
  // Every branch below returns the identical { error } shape to the
  // caller (see /api/share/[token]/route.ts — it never reads which
  // value this is, just whether "error" is present), so the client
  // response can never distinguish these cases. Server-side, they're
  // still worth telling apart for debugging/monitoring — logged here,
  // never sent anywhere client-visible. Only an 8-char token prefix is
  // logged, matching the existing rate-limit key convention, never the
  // raw token.
  const tokenPrefix = token.slice(0, 8);

  const rateLimitKey = `${clientIp}:${tokenPrefix}`;
  if (!checkRateLimit(rateLimitKey, { max: 20, windowMs: 60_000 })) {
    console.warn(`[share-resolve] rate limited: ip=${clientIp} token_prefix=${tokenPrefix}`);
    return { error: "not_active" };
  }

  // Throws rather than returning server_error: the caller renders every
  // error here as "Link no longer active — expired, revoked, or already
  // used", so a missing service role told a Trusted Contact their link was
  // dead. Same shape as the badge scan. A 500 says it is our problem.
  const service = requireSupabaseServiceClient(`lib/share-resolve token_prefix=${tokenPrefix}`);

  const { data: rpcData, error: rpcError } = await service.rpc("resolve_vessel_share", {
    p_token_hash: hashShareToken(token),
  });
  if (rpcError) {
    // Throws rather than returning server_error. The caller renders every
    // returned error as "Link no longer active — expired, revoked, or
    // already used", so a failed query told a Trusted Contact their link
    // was dead. Only the token's own verdicts may say that.
    console.error(`[share-resolve] resolve_vessel_share RPC failed: token_prefix=${tokenPrefix}`, rpcError);
    throw new Error(`resolve_vessel_share failed: ${rpcError.message}`);
  }

  const share = (Array.isArray(rpcData) ? rpcData[0] : null) as ShareRow | null;
  if (!share || !isShareFieldFlags(share.field_flags)) {
    // resolve_vessel_share() returns zero rows uniformly for not-found,
    // revoked, expired, and already-used one-time links — that's
    // deliberate (see the migration comment), so this branch can't say
    // which of those four it was without a second, non-atomic lookup
    // that would undermine the reason the RPC is atomic in the first
    // place. Logged as one bucket, honestly, not subdivided.
    console.warn(
      `[share-resolve] token resolved to no active share (not found, revoked, expired, or already used): token_prefix=${tokenPrefix}`,
    );
    return { error: "not_active" };
  }

  const { data: vesselRow } = await service.from("vessels").select("*").eq("id", share.vessel_id).maybeSingle();
  const vessel = vesselRow as VesselRecord | null;
  if (!vessel) {
    // A valid, active share row pointing at a vessel_id that no longer
    // resolves — shouldn't happen (vessel_id is a NOT NULL FK), and
    // signals a real data integrity issue worth seeing, not a normal
    // "link expired" case.
    console.error(`[share-resolve] share row resolved but vessel not found — data integrity issue: vessel_id=${share.vessel_id}`);
    return { error: "not_active" };
  }

  // The maintenance record, when the link carries it. THE ENTRIES ONLY:
  // withoutFilePaths strips every path before this leaves the server, so
  // the share cannot hand over an invoice even by accident. That is the
  // same line drawn at transfer — the history belongs to the boat, the
  // documents behind it belong to whoever uploaded them.
  //
  // Tolerates the table not existing yet (migrations run after the
  // deploy): an empty history, not a dead link.
  let serviceRecords: ServiceRecord[] = [];
  if (shareShowsService(share.field_flags)) {
    serviceRecords = withoutFilePaths(await loadServiceRecords(service, share.vessel_id));
  }

  return {
    vessel: filterVesselForShare(vessel, share.field_flags, share.access_note),
    sharedBy: vessel.owner_name,
    label: share.label,
    expiresAt: share.expires_at,
    serviceRecords,
  };
}
