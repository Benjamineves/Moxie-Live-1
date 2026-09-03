import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/admin-verify";
import { BROKER_PREVIEW_HTML } from "@/lib/broker-preview-html";

/**
 * Serves the static broker-facing design-preview page
 * (docs/design/moxie_digital_broker_preview.html) at an admin-only URL
 * so it can be pulled up on a phone in a meeting. Plain static HTML,
 * served as-is via a Route Handler -- deliberately not rebuilt as a
 * React page, since it's a standalone document with its own <html>/
 * <head>, not app content. Gated the same way every other admin surface
 * in this app is: requireAdmin(), redirect to /dashboard if not admin.
 */
export async function GET(request: Request) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return new NextResponse(BROKER_PREVIEW_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
