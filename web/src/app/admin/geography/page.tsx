import { redirect } from "next/navigation";
import { GeographyView } from "@/components/admin/GeographyView";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { countedVesselsFilter, summarizeGeography, type GeoVessel } from "@/lib/geography";

type Props = { searchParams: Promise<{ state?: string }> };

const GEO_COLUMNS =
  "mxe_id, vessel_name, storage_state, storage_zip, storage_county, storage_city, storage_description, marina_name, marina_city";

/**
 * Where registered boats are kept, by the ZIP on file. Regions come from
 * lib/region-config.ts; the counting rule and buckets from lib/geography.ts
 * (paid, not decommissioned — the same filter as the overview's totals).
 */
export default async function GeographyPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const service = requireSupabaseServiceClient("app/admin/geography/page");
  const { data, error } = await countedVesselsFilter(service.from("vessels").select(GEO_COLUMNS));
  if (error) throw new Error(`vessels read failed: ${error.message}`);
  const geo = summarizeGeography((data ?? []) as GeoVessel[]);

  const sp = await searchParams;
  return <GeographyView geo={geo} stateParam={sp.state} />;
}
