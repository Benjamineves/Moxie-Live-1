import Link from "next/link";
import { APP_ORIGIN } from "@/lib/site-domains";

function NavPixelM({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <rect x="0" y="0" width="25" height="10" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="0" y="0" width="10" height="25" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="75" y="0" width="25" height="10" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="90" y="0" width="10" height="25" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="0" y="90" width="25" height="10" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="0" y="75" width="10" height="25" rx="1" fill="#c9a84c" opacity=".55" />
      <rect x="15" y="25" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="55" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="65" width="10" height="10" fill="#c9a84c" />
      <rect x="15" y="75" width="10" height="10" fill="#c9a84c" />
      <rect x="25" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="35" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="45" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="55" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="65" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="25" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="35" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="45" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="55" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="65" width="10" height="10" fill="#c9a84c" />
      <rect x="75" y="75" width="10" height="10" fill="#c9a84c" />
      <rect x="85" y="85" width="8" height="8" fill="#17C3B2" />
    </svg>
  );
}

/**
 * Shared marketing nav, extracted out of MoxieMarketingHome so /pricing
 * (and any future marketing page) doesn't duplicate ~50 lines of
 * near-identical markup. Anchor links always point back to `/#section`
 * rather than a bare `#section` — that resolves correctly whether the
 * page you're currently on is `/` itself (same-page scroll, same as a
 * bare anchor) or anywhere else (navigates home, then scrolls).
 */
export function MarketingNav({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <nav className="fixed left-0 right-0 top-0 z-[100] flex items-center justify-between border-b border-[var(--divider)] bg-[rgba(245,242,236,0.92)] px-6 py-5 backdrop-blur-md md:px-12">
      <Link href="/" className="flex items-center gap-3 no-underline">
        <NavPixelM className="h-7 w-7 shrink-0" />
        <span className="font-[family-name:var(--font-display)] text-[22px] font-normal italic leading-none tracking-wide text-[var(--navy)]">
          <span className="text-[var(--gold)]">M</span>oxie
        </span>
      </Link>
      <div className="hidden items-center gap-8 md:flex">
        <Link
          href="/#qr-hero"
          className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
        >
          The QR
        </Link>
        <Link
          href="/#how"
          className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
        >
          How it works
        </Link>
        <Link
          href="/#who"
          className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
        >
          Who it&apos;s for
        </Link>
        <Link
          href="/pricing"
          className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
        >
          Pricing
        </Link>
        <Link
          href="/#contact"
          className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
        >
          Contact
        </Link>
        {isAuthenticated ? (
          <a
            href={`${APP_ORIGIN}/dashboard`}
            className="border border-[var(--navy)] bg-[var(--navy)] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--gold)] no-underline transition hover:border-[var(--gold)] hover:bg-[var(--gold)] hover:!text-[var(--navy)]"
          >
            Dashboard
          </a>
        ) : (
          <div className="flex items-center gap-3">
            <a
              href={`${APP_ORIGIN}/login`}
              className="text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--text2)] no-underline transition hover:text-[var(--gold)]"
            >
              Log in
            </a>
            <a
              href={`${APP_ORIGIN}/signup?next=%2Fdashboard`}
              className="border border-[var(--navy)] bg-[var(--navy)] px-5 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[var(--gold)] no-underline transition hover:border-[var(--gold)] hover:bg-[var(--gold)] hover:!text-[var(--navy)]"
            >
              Sign up
            </a>
          </div>
        )}
      </div>
    </nav>
  );
}
