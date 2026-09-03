import Link from "next/link";
import { PixelM } from "@/components/PixelM";

/** Shared marketing footer — see MarketingNav.tsx for why this is extracted. */
export function MarketingFooter({ isAuthenticated }: { isAuthenticated: boolean }) {
  return (
    <footer className="border-t border-[rgba(201,168,76,0.15)] bg-[var(--navy-deep)] px-12 py-12 text-center">
      <div className="mb-5 flex items-center justify-center gap-3">
        <PixelM size={20} />
        <span className="font-[family-name:var(--font-display)] text-lg italic text-white">
          <span className="text-[var(--gold)]">M</span>oxie
        </span>
        <span className="inline-block h-2 w-2 bg-[var(--aqua-bright)]" aria-hidden />
      </div>
      <p className="text-[11px] leading-relaxed text-[rgba(255,255,255,0.35)]">
        © 2026 Moxie Marine Technology · moxieyachting.com
      </p>
      <div className="mt-8 flex flex-wrap justify-center gap-4 font-[family-name:var(--font-dm)] text-[11px] text-[rgba(255,255,255,0.45)]">
        <Link className="text-[var(--gold)] no-underline hover:underline" href="/pricing">
          Pricing
        </Link>
        <span aria-hidden>·</span>
        {isAuthenticated ? (
          <Link className="text-[var(--gold)] no-underline hover:underline" href="/dashboard">
            Dashboard
          </Link>
        ) : (
          <>
            <Link className="text-[var(--gold)] no-underline hover:underline" href="/login">
              Log in
            </Link>
            <span aria-hidden>·</span>
            <Link className="text-[var(--gold)] no-underline hover:underline" href="/signup?next=%2Fdashboard">
              Sign up
            </Link>
          </>
        )}
      </div>
    </footer>
  );
}
