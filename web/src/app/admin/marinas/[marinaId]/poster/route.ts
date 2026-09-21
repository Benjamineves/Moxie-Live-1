import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { buildMarinaPosterPdf } from "@/lib/marina-poster-pdf";
import { formatJoinCode } from "@/lib/marina-access";

/**
 * The poster, as a download, for signing a marina up in person.
 *
 * `npm run marina-poster` is still there for batches, but a terminal
 * command on a Mac is no use standing in a marina office with a phone —
 * and the poster is the thing you leave behind. Same builder either way
 * (lib/marina-poster-pdf.ts), so the button and the script produce the
 * same file.
 *
 * ADMIN ONLY, re-checked here. The page hiding the button is not
 * authorization; a route handler serves whoever calls it.
 */
export async function GET(_request: Request, context: { params: Promise<{ marinaId: string }> }) {
  const admin = await requireAdmin();
  if (!admin) return NextResponse.json({ error: "Admins only." }, { status: 403 });

  const { marinaId } = await context.params;
  const service = requireSupabaseServiceClient("app/admin/marinas/[marinaId]/poster/route");
  const { data, error } = await service.from("marinas").select("name, city, join_code").eq("id", marinaId).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const marina = data as { name: string; city: string | null; join_code: string | null } | null;
  if (!marina) return NextResponse.json({ error: "Marina not found." }, { status: 404 });
  if (!marina.join_code) {
    // A poster without a code is a poster nobody can use.
    return NextResponse.json({ error: "This marina has no join code yet — issue one first." }, { status: 409 });
  }

  let pdf: Uint8Array;
  try {
    pdf = await buildMarinaPosterPdf({ marinaName: marina.name, city: marina.city, joinCode: marina.join_code });
  } catch (e) {
    // A name with characters outside the font subset, most likely.
    return NextResponse.json({ error: (e as Error).message }, { status: 422 });
  }

  const slug = marina.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return new NextResponse(pdf as unknown as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="moxie-poster-${slug}-${formatJoinCode(marina.join_code)}.pdf"`,
      // Regenerating a code must not hand out the old poster.
      "Cache-Control": "no-store",
    },
  });
}
