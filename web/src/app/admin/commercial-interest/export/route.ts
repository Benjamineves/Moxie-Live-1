import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { loadCommercialInterest, toCsv } from "@/lib/commercial-interest";

/**
 * The list as a CSV, which is the point of collecting it: one mail merge
 * when the commercial tier opens.
 *
 * Admin only, re-checked here — this is the whole list of addresses, and a
 * route handler serves whoever calls it.
 */
export async function GET() {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const service = requireSupabaseServiceClient("app/admin/commercial-interest/export/route");
  const rows = await loadCommercialInterest(service);
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(toCsv(rows), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="moxie-commercial-interest-${today}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
