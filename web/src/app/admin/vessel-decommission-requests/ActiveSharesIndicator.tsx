/**
 * Context for a "sold outside Moxie" decommission request: how many
 * Trusted Contact share links the vessel still has live.
 *
 * Not a gate, and deliberately not styled as a warning when the count is
 * zero. The pattern worth an admin's attention is a sale reason arriving
 * while broad share links are still open — approval revokes them all in
 * the same transaction, and whoever was relying on one simply stops
 * being able to load the profile. Saying so on the badge is the point:
 * the admin can decide whether that's worth a message before approving,
 * which is a judgement call, not a rule.
 */
export function ActiveSharesIndicator({ count }: { count: number }) {
  const tone =
    count > 0 ? "bg-[var(--amber-bg)] text-[var(--amber-fg)]" : "bg-[var(--gray-bg)] text-[var(--gray-fg)]";

  return (
    <p
      className={`mt-1.5 inline-block rounded-lg px-2 py-0.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.06em] ${tone}`}
    >
      {count === 0
        ? "No active share links"
        : `${count} active share link${count === 1 ? "" : "s"} — revoked on approval`}
    </p>
  );
}
