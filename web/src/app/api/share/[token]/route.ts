import { NextResponse } from "next/server";
import { resolveShareByToken } from "@/lib/share-resolve";

const NOT_ACTIVE = { error: "This link is no longer active." };

/**
 * Spec §5: public, no auth. On failure (expired/revoked/not
 * found/already used/rate-limited) returns the same generic response
 * regardless of which — never leaking whether a guessed token ever
 * existed. See lib/share-resolve.ts for the atomic resolve + rate limit;
 * this route and the recipient page (app/[mxeId]/page.tsx) both call it,
 * so there's one implementation, not two.
 */
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params;
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";

  const result = await resolveShareByToken(token, ip);
  if ("error" in result) {
    return NextResponse.json(NOT_ACTIVE, { status: 404 });
  }

  return NextResponse.json({
    ...result.vessel,
    shared_by: result.sharedBy,
    share_label: result.label,
    expires_at: result.expiresAt,
  });
}
