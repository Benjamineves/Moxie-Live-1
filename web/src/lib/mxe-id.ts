/**
 * What an MXE ID looks like, in one place.
 *
 * This exists because the 404 boundary and the page that triggers it have
 * to agree on it. `/[mxeId]` is a root-level dynamic segment, so *any*
 * single-segment URL reaches it — `/pricng` as much as `/MXE-01024`. The
 * page 404s on both, and the boundary decides which copy to show by asking
 * this same question of the path. Two copies of the pattern that drifted
 * apart would put "that vessel code does not exist" back in front of
 * someone who mistyped a marketing URL, which is the bug this replaced.
 *
 * Case-insensitive, matching the page: a scanner or a hand-typed address
 * can deliver lowercase, and the canonical form is uppercase.
 *
 * Note `lib/unpaid-vessel-delete.ts` keeps its own case-SENSITIVE copy for
 * a guarded write path. Deliberately not merged here — loosening the guard
 * on a delete path is not a 404-copy change.
 */
export const MXE_ID_PATTERN = /^MXE-\d{5}$/i;

/** Whether `value` has the shape of an MXE ID. Says nothing about whether it exists. */
export function looksLikeMxeId(value: string | null | undefined): boolean {
  return typeof value === "string" && MXE_ID_PATTERN.test(value.trim());
}
