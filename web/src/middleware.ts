import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { APP_HOST, APP_ORIGIN, MARKETING_HOST, MARKETING_ORIGIN } from "@/lib/site-domains";

// Marketing/static routes allowed to render on moxieyachting.com. Everything
// else there is an app route and gets redirected to moxieyacht.com — see
// docs/moxie_digital_pwa_spec.md for why the two domains split this way.
const MARKETING_PATHS = new Set(["/", "/pricing"]);

function domainRedirect(request: NextRequest): NextResponse | null {
  // request.nextUrl.hostname reflects the server's own bind address, not
  // necessarily the domain the client actually requested — the Host header
  // is the correct signal for routing by custom domain on a shared deployment.
  const host = (request.headers.get("host") ?? "").replace(/^www\./, "").split(":")[0];
  const path = request.nextUrl.pathname;

  // API routes aren't navigations — redirecting them (esp. 301s on non-GET
  // requests) risks breaking fetch calls and webhooks. Leave them alone;
  // NEXT_PUBLIC_BASE_URL and the Stripe webhook already point at the app
  // domain, so nothing external should be hitting them cross-domain.
  if (path.startsWith("/api/")) return null;

  if (host === MARKETING_HOST && !MARKETING_PATHS.has(path)) {
    const target = new URL(path + request.nextUrl.search, APP_ORIGIN);
    return NextResponse.redirect(target, 301);
  }

  if (host === APP_HOST && path === "/") {
    const target = new URL("/", MARKETING_ORIGIN);
    return NextResponse.redirect(target, 301);
  }

  return null;
}

export async function middleware(request: NextRequest) {
  const redirect = domainRedirect(request);
  if (redirect) return redirect;

  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return supabaseResponse;
  }

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options),
        );
      },
    },
  });

  await supabase.auth.getUser();

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
