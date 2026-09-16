import { MoxieMarketingHome } from "@/components/marketing/MoxieMarketingHome";
import { requireSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await requireSupabaseServerClient("app/page");

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <MoxieMarketingHome isAuthenticated={!!user} />;
}
