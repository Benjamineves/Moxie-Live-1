import { NextResponse } from "next/server";
import { getPublicSupabase } from "@/lib/supabase-public";

export async function POST(request: Request) {
  let body: { email?: string };
  try {
    body = (await request.json()) as { email?: string };
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "Valid email required" }, { status: 400 });
  }

  const supabase = getPublicSupabase();
  if (!supabase) {
    return NextResponse.json(
      { ok: true, warning: "Stored locally only — configure Supabase for persistence." },
      { status: 200 },
    );
  }

  const { error } = await supabase.from("waitlist").insert({
    email,
    source: "homepage",
  });

  if (error) {
    /* Unique violation etc. */
    if (error.code === "23505") {
      return NextResponse.json({ ok: true, duplicate: true }, { status: 200 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
