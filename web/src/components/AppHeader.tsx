/**
 * Shared chrome for the two vessel-profile headers — VesselOwnerProfile.tsx
 * and [mxeId]/page.tsx's public branch. These were near-duplicated markup
 * that had silently drifted apart: the public header's wordmark was a
 * plain <p>, a dead end for anyone who reached it with no browser back
 * button — the standalone PWA has none (see moxie_digital_pwa_spec.md's
 * "No back button" section).
 *
 * wordmarkHref is resolved by the caller, not looked up here — one
 * caller (VesselOwnerProfile) already knows the answer unconditionally
 * (reaching it requires being the confirmed authenticated owner, so it's
 * always "/dashboard"); the other ([mxeId]/page.tsx's public branch)
 * resolves session state itself and passes the result in. A plain <a>,
 * not next/link's Link, since this href is sometimes cross-origin
 * (MARKETING_ORIGIN for a logged-out visitor) and sometimes not, and
 * there's no reason to special-case a header wordmark for SPA prefetch.
 */
export function AppHeader({
  role,
  wordmarkHref,
  children,
}: {
  role: "Public" | "Owner";
  wordmarkHref: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-5 py-4">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
        <a
          href={wordmarkHref}
          className="font-[family-name:var(--font-display)] text-lg font-light italic text-white"
        >
          <span className="text-[var(--gold)]">M</span>oxie
        </a>
        <div className="flex items-center gap-4">
          {/* .45 vs .55 opacity preserved exactly from the two pre-merge
              implementations — not obviously deliberate, but "keep the
              role label as-is" means as-is, not "pick one." */}
          <span
            className={`font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] ${
              role === "Owner" ? "text-[rgba(255,255,255,.55)]" : "text-[rgba(255,255,255,.45)]"
            }`}
          >
            {role}
          </span>
          {children}
        </div>
      </div>
    </header>
  );
}
