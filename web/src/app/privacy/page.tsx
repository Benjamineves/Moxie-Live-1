import type { Metadata } from "next";
import { LegalPage, LegalPending } from "@/components/marketing/LegalPage";
import { requireSupabaseServerClient } from "@/lib/supabase/server";

// Not indexed and not linked until the attorney-reviewed text is in
// (legal-pages.test.mts). Renders on both domains (middleware MARKETING_PATHS).
export const metadata: Metadata = {
  title: "Privacy Policy · Moxie",
  robots: { index: false, follow: false },
};

export default async function PrivacyPage() {
  const supabase = await requireSupabaseServerClient("app/privacy/page");
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <LegalPage title="Privacy Policy" lastUpdated={null} isAuthenticated={!!user}>
      <LegalPending what="privacy policy" />
    </LegalPage>
  );
}
