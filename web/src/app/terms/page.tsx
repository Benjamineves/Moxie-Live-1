import type { Metadata } from "next";
import { LegalPage, LegalPending } from "@/components/marketing/LegalPage";
import { requireSupabaseServerClient } from "@/lib/supabase/server";

// Not indexed and not linked until the attorney-reviewed text is in
// (legal-pages.test.mts). Renders on both domains (middleware MARKETING_PATHS).
export const metadata: Metadata = {
  title: "Terms of Service · Moxie",
  robots: { index: false, follow: false },
};

export default async function TermsPage() {
  const supabase = await requireSupabaseServerClient("app/terms/page");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <LegalPage title="Terms of Service" lastUpdated={null} isAuthenticated={!!user}>
      <LegalPending what="terms of service" />
    </LegalPage>
  );
}
