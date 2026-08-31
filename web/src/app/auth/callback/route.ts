import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const callbackOrigin = new URL(request.url).origin;

  if (!url || !key) {
    return NextResponse.redirect(new URL("/login", callbackOrigin));
  }

  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next") ?? "/dashboard";
  const next =
    rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  if (code) {
    const cookieStore = await cookies();
    const supabase = createServerClient(url, key, {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        },
      },
    });
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(new URL(next, origin));
    }
    // A failed recovery-code exchange (expired/already-used link) should
    // land back on /reset-password, which renders its own expired-link
    // state when it finds no session — not the generic login error.
    if (next === "/reset-password") {
      return NextResponse.redirect(new URL("/reset-password", origin));
    }
  }

  return NextResponse.redirect(new URL("/login?error=auth", origin));
}
