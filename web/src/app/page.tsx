import { MoxieMarketingHome } from "@/components/marketing/MoxieMarketingHome";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <MoxieMarketingHome isAuthenticated={false} />;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <MoxieMarketingHome isAuthenticated={!!user} />;
}
