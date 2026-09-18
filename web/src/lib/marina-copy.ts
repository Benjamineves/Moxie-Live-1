/**
 * What the owner is told a marina will see. One sentence, used on the
 * join page's confirm step, kept here so a test can hold it to the real
 * field set in marina-view.ts: contact and emergency contact always, the
 * two documents only as chosen. If the view ever gains a field, the copy
 * that promised less is the thing that has to change.
 */
export function marinaSharingSummary(marinaName: string, vesselName: string, registration: boolean, insurance: boolean): string {
  const docs =
    registration && insurance
      ? ", plus your registration and insurance documents"
      : registration
        ? ", plus your registration document"
        : insurance
          ? ", plus your insurance document"
          : "";
  return `${marinaName} will see your contact details and emergency contact${docs} when their staff scan ${vesselName}'s badge.`;
}

/**
 * Whether a storage save moved the vessel to a different marina, which is
 * when the owner is asked about removing the old marina's access (spec
 * §2.4). Whitespace and case aren't a move; clearing the name (moving to a
 * trailer, say) is.
 */
export function marinaNameChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  const norm = (v: string | null | undefined) => (v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
  return norm(before) !== norm(after);
}
