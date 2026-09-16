import type { Metadata } from "next";
import { MoxieFaq } from "@/components/marketing/MoxieFaq";
import { requireSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "FAQ · Moxie",
  description:
    "What Moxie is, what a scan shows, and what happens to the record when the boat changes hands.",
};

/**
 * `/faq`. Reachable on both domains: it is in the middleware's
 * MARKETING_PATHS so it renders on moxieyachting.com next to /pricing, and
 * nothing redirects it away from moxieyacht.com, where the public vessel
 * profile links to it. A stranger who has just scanned a badge is the
 * highest-intent reader this page has.
 */
export default async function FaqPage() {
  const supabase = await requireSupabaseServerClient("app/faq/page");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <MoxieFaq isAuthenticated={!!user} />;
}
