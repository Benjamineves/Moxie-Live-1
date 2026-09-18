import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";
import { getDormantInfo } from "./vessel-dormancy.ts";
import { buildRosterRow, byName, type MarinaGrant, type RosterRow, type RosterSource } from "./marina-view.ts";

/**
 * Who a marina is, and whether it may see a vessel.
 * docs/moxie_digital_marina_access_spec.md.
 *
 * The decision lives here and nowhere else: the scan page, the documents
 * route and the roster all ask this module, and marina-access.test.mts
 * fails if anything else reads marina_vessel_access or calls its RPCs. A
 * check made in one caller is not enforcement (CLAUDE.md).
 *
 * `?role=marina` in a URL is never authorization. It is re-derived here on
 * every request, exactly as `?role=owner` is.
 *
 * DEPLOY ORDER. This ships before 20261007_marina_access.sql runs. A
 * missing table (PGRST205 / 42P01) reads as "no marina has access", so a
 * public scan never 500s for want of a feature nobody has used yet.
 */

type ServiceClient = SupabaseClient<PermissiveDatabase>;

// ─── Join code ────────────────────────────────────────────────────────────

/**
 * No 0/O, 1/I/L: the code is read off a poster on an office wall and typed
 * on a phone. Must match the CHECK constraint in 20261007.
 */
export const JOIN_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const JOIN_CODE_LENGTH = 8;

/**
 * What a person typed → the stored form, or null if it can't be a code.
 * Case, spaces and the display hyphen are forgiven; look-alike characters
 * are not guessed at (an "O" is not silently read as a "0"), because a
 * wrong guess lands on a different marina.
 */
export function normalizeJoinCode(input: string | null | undefined): string | null {
  const stripped = (input ?? "").toUpperCase().replace(/[\s-]+/g, "");
  if (stripped.length !== JOIN_CODE_LENGTH) return null;
  for (const ch of stripped) if (!JOIN_CODE_ALPHABET.includes(ch)) return null;
  return stripped;
}

/** Stored form → how it is printed and shown: XXXX-XXXX. */
export function formatJoinCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

// Codes are generated in SQL, by generate_marina_join_code (20261008),
// where the unique index can see a collision. There is no generator here.

// ─── The decision ─────────────────────────────────────────────────────────

export type MarinaMembership = { marinaId: string; name: string; city: string | null };

export type ActiveAccess = MarinaGrant & {
  id: string;
  marina_id: string;
  vessel_id: string;
  granted_at: string;
};

export type VesselGate = {
  id: string;
  qr_status: string | null;
  lifecycle_status: string | null;
  dormant_cause: string | null;
};

export type MarinaViewer =
  /** Not a marina user. Everything renders as it does today. */
  | { kind: "none" }
  /** A marina user this vessel hasn't shared with. Public profile + banner. */
  | { kind: "no_access"; marina: MarinaMembership }
  /** Shared. `dormant` = roster row and emergency contact only. */
  | { kind: "access"; marina: MarinaMembership; access: ActiveAccess; dormant: boolean };

export function decideMarinaViewer(
  membership: MarinaMembership | null,
  access: ActiveAccess | null,
  vessel: VesselGate,
): MarinaViewer {
  if (!membership) return { kind: "none" };
  // Belt and braces: the row must be for THIS marina and THIS vessel, so a
  // loader bug can never hand one marina another's grant.
  const matches = !!access && access.marina_id === membership.marinaId && access.vessel_id === vessel.id;
  // Pending activation: a grant can't exist (the RPC refuses), and the page
  // shows "Not yet active" to everyone. Decommissioned: out of the roster
  // and the view, without a revocation write (spec §4.3).
  if (!matches || vessel.qr_status !== "active" || vessel.lifecycle_status === "decommissioned") {
    return { kind: "no_access", marina: membership };
  }
  return {
    kind: "access",
    marina: membership,
    access: access!,
    dormant: getDormantInfo(vessel).isDormant,
  };
}

export const MARINA_DOC_TYPES = ["registration", "insurance"] as const;
export type MarinaDocType = (typeof MARINA_DOC_TYPES)[number];

/**
 * May this viewer fetch this document's bytes? Registration and insurance
 * only, only if the owner included it, never while dormant — documents are
 * suspended for the owner too then (dormant identity spec §3).
 */
export function decideMarinaDocument(viewer: MarinaViewer, docType: string): boolean {
  if (viewer.kind !== "access" || viewer.dormant) return false;
  if (docType === "registration") return viewer.access.share_registration;
  if (docType === "insurance") return viewer.access.share_insurance;
  return false;
}

// ─── Loaders ──────────────────────────────────────────────────────────────

export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

/**
 * Staff membership is `users.marina_id`, not `role = 'marina_operator'`
 * (spec §9.2): a harbormaster who owns a boat can be both.
 *
 * Looked up by email, not auth id — the same way ownership is matched
 * (owner-verify.ts), because some users rows carry placeholder ids that
 * differ from their auth ids.
 */
export async function loadMarinaMembership(service: ServiceClient, email: string | null | undefined): Promise<MarinaMembership | null> {
  const normalized = email?.trim().toLowerCase();
  if (!normalized) return null;

  const { data: userRow, error } = await service
    .from("users")
    .select("marina_id")
    .eq("email", normalized)
    .maybeSingle();
  if (error) throw new Error(`Failed to load marina membership: ${error.message}`);
  const marinaId = (userRow as { marina_id: string | null } | null)?.marina_id;
  if (!marinaId) return null;

  const { data: marina, error: marinaError } = await service
    .from("marinas")
    .select("id, name, city")
    .eq("id", marinaId)
    .maybeSingle();
  if (marinaError) throw new Error(`Failed to load marina: ${marinaError.message}`);
  const m = marina as { id: string; name: string; city: string | null } | null;
  return m ? { marinaId: m.id, name: m.name, city: m.city } : null;
}

const ACCESS_COLUMNS = "id, marina_id, vessel_id, share_registration, share_insurance, granted_at";

export async function loadActiveAccess(service: ServiceClient, marinaId: string, vesselId: string): Promise<ActiveAccess | null> {
  const { data, error } = await service
    .from("marina_vessel_access")
    .select(ACCESS_COLUMNS)
    .eq("marina_id", marinaId)
    .eq("vessel_id", vesselId)
    .is("revoked_at", null)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`Failed to load marina access: ${error.message}`);
  }
  return (data as ActiveAccess | null) ?? null;
}

export type MarinaSummary = { id: string; name: string; city: string | null };

/**
 * The join page's lookup: code → one marina, or null. A missing join_code
 * column (42703) reads as "no such marina" rather than a 500, for the
 * window between a deploy and 20261007 running.
 */
export async function loadMarinaByJoinCode(service: ServiceClient, input: string | null | undefined): Promise<MarinaSummary | null> {
  const code = normalizeJoinCode(input);
  if (!code) return null;
  const { data, error } = await service.from("marinas").select("id, name, city").eq("join_code", code).maybeSingle();
  if (error) {
    if (error.code === "42703") return null;
    throw new Error(`Failed to look up join code: ${error.message}`);
  }
  return (data as MarinaSummary | null) ?? null;
}

export type VesselMarinaAccess = ActiveAccess & { marina: MarinaSummary };

/** Active grants on these vessels, with the marina each is for. For the owner's own pages. */
export async function loadVesselMarinaAccess(service: ServiceClient, vesselIds: string[]): Promise<VesselMarinaAccess[]> {
  if (vesselIds.length === 0) return [];
  const { data, error } = await service
    .from("marina_vessel_access")
    .select(`${ACCESS_COLUMNS}, marinas(id, name, city)`)
    .in("vessel_id", vesselIds)
    .is("revoked_at", null)
    .order("granted_at", { ascending: true });
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Failed to load marina access: ${error.message}`);
  }
  return ((data ?? []) as unknown as (ActiveAccess & { marinas: MarinaSummary | null })[])
    .filter((row) => row.marinas)
    .map(({ marinas, ...row }) => ({ ...row, marina: marinas! }));
}

const ROSTER_VESSEL_COLUMNS =
  "id, mxe_id, vessel_name, slip_number, owner_name, emg_name, emg_phone, emg_relationship, doc_registration_url, doc_insurance_url, qr_status, lifecycle_status, dormant_cause";

/**
 * Every vessel shared with this marina, as roster rows (/marina).
 * Decommissioned vessels drop out without a revocation write (spec §4.3);
 * dormant ones stay, paused. The same decideMarinaViewer rules as a scan,
 * so the roster can never list a boat whose page would refuse the marina.
 */
export async function loadMarinaRoster(service: ServiceClient, membership: MarinaMembership): Promise<RosterRow[]> {
  const { data, error } = await service
    .from("marina_vessel_access")
    .select(`${ACCESS_COLUMNS}, vessels(${ROSTER_VESSEL_COLUMNS})`)
    .eq("marina_id", membership.marinaId)
    .is("revoked_at", null);
  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Failed to load marina roster: ${error.message}`);
  }
  const rows: RosterRow[] = [];
  for (const raw of (data ?? []) as unknown as (ActiveAccess & { vessels: (RosterSource & VesselGate) | null })[]) {
    const { vessels: vessel, ...access } = raw;
    if (!vessel) continue;
    const viewer = decideMarinaViewer(membership, access, vessel);
    if (viewer.kind !== "access") continue;
    rows.push(buildRosterRow(vessel, access, viewer.dormant));
  }
  return rows.sort(byName);
}

/** The marina's own code, for its empty roster ("give tenants this"). */
export async function loadMarinaJoinCode(service: ServiceClient, marinaId: string): Promise<string | null> {
  const { data, error } = await service.from("marinas").select("join_code").eq("id", marinaId).maybeSingle();
  if (error) {
    if (error.code === "42703") return null;
    throw new Error(`Failed to load join code: ${error.message}`);
  }
  return (data as { join_code: string | null } | null)?.join_code ?? null;
}

/** Active grant count per marina, for /admin/marinas. */
export async function countActiveGrantsByMarina(service: ServiceClient): Promise<Map<string, number>> {
  const { data, error } = await service.from("marina_vessel_access").select("marina_id").is("revoked_at", null);
  if (error) {
    if (isMissingTable(error)) return new Map();
    throw new Error(`Failed to count marina access: ${error.message}`);
  }
  const counts = new Map<string, number>();
  for (const row of (data ?? []) as { marina_id: string }[]) counts.set(row.marina_id, (counts.get(row.marina_id) ?? 0) + 1);
  return counts;
}

/**
 * Sets a marina's code through generate_marina_join_code (20261008), which
 * retries collisions where the unique index can see them. replace=false
 * returns an existing code untouched, so a printed poster stays valid.
 */
export async function generateMarinaJoinCode(service: ServiceClient, marinaId: string, replace: boolean): Promise<string> {
  const { data, error } = await service.rpc("generate_marina_join_code", { p_marina_id: marinaId, p_replace: replace });
  if (error) throw new Error(`generate_marina_join_code failed: ${error.message}`);
  return data as string;
}

/** The one call the scan page and the documents route make. */
export async function resolveMarinaViewer(
  service: ServiceClient,
  email: string | null | undefined,
  vessel: VesselGate,
): Promise<MarinaViewer> {
  const membership = await loadMarinaMembership(service, email);
  if (!membership) return { kind: "none" };
  const access = await loadActiveAccess(service, membership.marinaId, vessel.id);
  return decideMarinaViewer(membership, access, vessel);
}

// ─── Writes (through the RPCs, which re-verify everything) ────────────────

export type GrantRefusal = "unknown_code" | "not_owner" | "vessel_not_eligible";
export type RevokeRefusal = "not_owner" | "not_found";

const GRANT_REFUSALS: Record<string, GrantRefusal> = {
  MX030: "unknown_code",
  MX031: "not_owner",
  MX032: "vessel_not_eligible",
};
const REVOKE_REFUSALS: Record<string, RevokeRefusal> = {
  MX031: "not_owner",
  MX033: "not_found",
};

export type GrantResult =
  | { ok: true; accessId: string; marinaId: string; created: boolean }
  | { ok: false; refusal: GrantRefusal };

export async function grantMarinaAccess(
  service: ServiceClient,
  input: { ownerId: string; vesselId: string; joinCode: string } & MarinaGrant,
): Promise<GrantResult> {
  const code = normalizeJoinCode(input.joinCode);
  if (!code) return { ok: false, refusal: "unknown_code" };

  const { data, error } = await service.rpc("grant_marina_access", {
    p_owner_id: input.ownerId,
    p_vessel_id: input.vesselId,
    p_join_code: code,
    p_share_registration: input.share_registration,
    p_share_insurance: input.share_insurance,
  });
  if (error) {
    const refusal = GRANT_REFUSALS[error.code ?? ""];
    if (refusal) return { ok: false, refusal };
    throw new Error(`grant_marina_access failed: ${error.message}`);
  }
  const row = (Array.isArray(data) ? data[0] : data) as { access_id: string; marina_id: string; created: boolean };
  return { ok: true, accessId: row.access_id, marinaId: row.marina_id, created: row.created };
}

/**
 * Changing which documents an existing grant includes. There is no
 * separate RPC for this: grant_marina_access already updates the active
 * row's choices in place, and re-verifies ownership and that the vessel is
 * active. The marina's CURRENT code is looked up by id, so a regenerated
 * poster doesn't strand the owner's settings.
 */
export async function updateMarinaAccessDocuments(
  service: ServiceClient,
  input: { ownerId: string; vesselId: string; marinaId: string } & MarinaGrant,
): Promise<GrantResult> {
  const { data, error } = await service.from("marinas").select("join_code").eq("id", input.marinaId).maybeSingle();
  if (error) throw new Error(`Failed to load marina: ${error.message}`);
  const code = (data as { join_code: string | null } | null)?.join_code;
  if (!code) return { ok: false, refusal: "unknown_code" };
  return grantMarinaAccess(service, {
    ownerId: input.ownerId,
    vesselId: input.vesselId,
    joinCode: code,
    share_registration: input.share_registration,
    share_insurance: input.share_insurance,
  });
}

export type RevokeResult = { ok: true; changed: boolean } | { ok: false; refusal: RevokeRefusal };

export async function revokeMarinaAccess(service: ServiceClient, input: { ownerId: string; accessId: string }): Promise<RevokeResult> {
  const { data, error } = await service.rpc("revoke_marina_access", {
    p_owner_id: input.ownerId,
    p_access_id: input.accessId,
  });
  if (error) {
    const refusal = REVOKE_REFUSALS[error.code ?? ""];
    if (refusal) return { ok: false, refusal };
    throw new Error(`revoke_marina_access failed: ${error.message}`);
  }
  return { ok: true, changed: data === true };
}
