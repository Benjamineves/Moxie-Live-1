import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub";

/**
 * Badge pool depth, and who needs a hand-printed badge (spec §3.2).
 *
 * One module rather than three copies, because §3.2's two requirements
 * are the same fact seen from different pages: the dashboard alarm, the
 * fulfilment queue's flag, and the batch page's counter all have to agree
 * about what "low" means and about which vessels missed the pool. Three
 * hardcoded thresholds would drift the first time one of them moved.
 */

/**
 * §3.2's thresholds, and the units matter: these count IDENTITIES, not
 * physical badges. Each identity ships as two copies (§1.6), so 25
 * identities is 50 badges — the number reads as twice the safety it is
 * unless every surface says "identities" out loud. Against a 100-identity
 * batch these are a quarter and a tenth.
 */
export const POOL_AMBER_THRESHOLD = 25;
export const POOL_RED_THRESHOLD = 10;

export type PoolLevel = "ok" | "amber" | "red" | "empty";

export function poolLevel(available: number): PoolLevel {
  if (available <= 0) return "empty";
  if (available <= POOL_RED_THRESHOLD) return "red";
  if (available <= POOL_AMBER_THRESHOLD) return "amber";
  return "ok";
}

export type BadgePoolStatus = {
  /** Identities currently assignable — status in_stock, channel direct. */
  available: number;
  level: PoolLevel;
  /**
   * When stock first became assignable, or null if it never has.
   *
   * This is what separates "the pool was empty when this vessel signed
   * up" from "this vessel predates the pool entirely". Every vessel
   * registered before Moxie held any stock has a null badge_identity_id
   * and always will — flagging those would put a permanent "print
   * individually" badge on ten historical rows that were already printed
   * and shipped the old way, and an alert that is always on is an alert
   * nobody reads.
   *
   * Derived from the earliest identity to reach in_stock rather than
   * stored separately, so it cannot fall out of step with the inventory
   * it describes.
   */
  stockSince: string | null;
};

/**
 * Reads pool depth and the stock-since cutoff in two cheap counts.
 * Callers pass their own service client so this stays a pure query
 * helper with no opinion about authorization — every caller is already
 * behind requireAdmin().
 */
export async function readBadgePoolStatus(
  service: SupabaseClient<PermissiveDatabase>,
): Promise<BadgePoolStatus> {
  const { count } = await service
    .from("badge_identities")
    .select("id", { count: "exact", head: true })
    .eq("status", "in_stock")
    .eq("distribution_channel", "direct");

  const { data: firstStocked } = await service
    .from("badge_identities")
    .select("shipped_at")
    .not("shipped_at", "is", null)
    .order("shipped_at", { ascending: true })
    .limit(1);

  const available = count ?? 0;
  return {
    available,
    level: poolLevel(available),
    stockSince: firstStocked?.[0]?.shipped_at ?? null,
  };
}

/**
 * Whether a vessel's badge has to be printed by hand.
 *
 * True only when the vessel could have drawn from the pool and did not —
 * which is exactly §3.2's fallback, and exactly the row that needs
 * chasing. A vessel registered before any stock existed is not a
 * fallback; it is history.
 */
export function needsIndividualPrinting(
  vessel: { badge_identity_id: string | null; created_at: string | null },
  stockSince: string | null,
): boolean {
  if (vessel.badge_identity_id) return false;
  if (!stockSince || !vessel.created_at) return false;
  return Date.parse(vessel.created_at) >= Date.parse(stockSince);
}
