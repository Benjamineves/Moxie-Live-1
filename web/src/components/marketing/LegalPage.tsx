import type { ReactNode } from "react";
import { MarketingNav } from "@/components/marketing/MarketingNav";
import { MarketingFooter } from "@/components/marketing/MarketingFooter";

export const legalBody = "font-[family-name:var(--font-dm)] text-[15px] font-light leading-relaxed text-[var(--text2)]";

/**
 * Shell for /terms and /privacy. The attorney-reviewed text goes in as
 * children; until then each page renders `LegalPending`. Both pages are
 * noindex and linked from nowhere (legal-pages.test.mts) until the text is in.
 */
export function LegalPage({
  title,
  lastUpdated,
  isAuthenticated,
  children,
}: {
  title: string;
  lastUpdated: string | null;
  isAuthenticated: boolean;
  children: ReactNode;
}) {
  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <MarketingNav isAuthenticated={isAuthenticated} />
      <main className="mx-auto max-w-[760px] px-6 pb-24 pt-32 md:px-8">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic leading-tight text-[var(--navy)] md:text-4xl">
          {title}
        </h1>
        {lastUpdated ? <p className={`mt-3 ${legalBody}`}>Last updated {lastUpdated}</p> : null}
        <div className="mt-10 flex flex-col gap-5">{children}</div>
      </main>
      <MarketingFooter isAuthenticated={isAuthenticated} />
    </div>
  );
}

/** Placeholder until the reviewed text arrives. Says nothing about terms. */
export function LegalPending({ what }: { what: string }) {
  return (
    <p className={legalBody}>
      Our {what} is being finalised and will be published here. Questions in the meantime:{" "}
      <a href="mailto:support@moxieyachting.com" className="text-[var(--blue-fg)] underline">
        support@moxieyachting.com
      </a>
      .
    </p>
  );
}
