import { NextResponse } from "next/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * Homepage "Not ready yet?" email capture.
 *
 * Writes with the SERVICE ROLE. It used to insert with the anon key, but
 * waitlist has RLS on and no INSERT policy, so every submission since RLS
 * was enabled failed with a 500 — the table held 0 rows on 2026-09-25. An
 * anon INSERT policy would work too, but it would also let anyone holding
 * the public key write rows directly, bypassing the validation below.
 *
 * A missing configuration is a 500 (requireSupabaseServiceClient throws).
 * It used to answer `ok: true` with "Stored locally only", telling a
 * visitor they were on the list when nothing had been saved anywhere.
 */
export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const service = requireSupabaseServiceClient("app/api/waitlist/route");

  // No unique constraint on waitlist.email is known to exist, so a repeat
  // signup is answered from a lookup rather than a 23505. A race between two
  // identical submissions can still write two rows; harmless for a list.
  const { data: existing, error: lookupError } = await service
    .from("waitlist")
    .select("id")
    .eq("email", email)
    .limit(1);
  if (lookupError) {
    console.error("[waitlist] lookup failed", lookupError);
    return NextResponse.json({ error: "Could not save — try again" }, { status: 500 });
  }
  if ((existing ?? []).length > 0) {
    return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
  }

  const { error } = await service.from("waitlist").insert({ email, source: "homepage" });
  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    // Logged, not echoed: the database's message is not for visitors.
    console.error("[waitlist] insert failed", error);
    return NextResponse.json({ error: "Could not save — try again" }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
