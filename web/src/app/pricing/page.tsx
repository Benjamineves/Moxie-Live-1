import type { Metadata } from "next";
import { MoxiePricing } from "@/components/marketing/MoxiePricing";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Pricing · Moxie",
  description: "Simple pricing for permanent vessel identity — one badge fee, one plan to manage it.",
};

export default async function PricingPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <MoxiePricing isAuthenticated={false} />;
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();

  return <MoxiePricing isAuthenticated={!!user} />;
}
