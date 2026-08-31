import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { getOwnerBillingSummary } from "@/lib/billing-service";

/** GET /api/users/:userId/billing — build spec §14. */
export async function GET(_request: Request, context: { params: Promise<{ userId: string }> }) {
  const { userId } = await context.params;

  const authClient = await createSupabaseServerClient();
  if (!authClient) {
    return NextResponse.json({ error: "Missing Supabase auth configuration." }, { status: 503 });
  }

  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Missing Supabase service role configuration." }, { status: 503 });
  }

  // Resolve the caller's own users.id the same way the rest of the app
  // does (email match, not auth.uid() — see build spec §9-C-13), then
  // require it to match the requested :userId. Never trust the path param
  // alone — that would let any signed-in user read anyone's billing by
  // guessing/enumerating ids.
  const normalizedEmail = user.email.trim().toLowerCase();
  const { data: ownerRow } = await service.from("users").select("id").eq("email", normalizedEmail).maybeSingle();
  const resolvedId = (ownerRow as { id: string } | null)?.id ?? user.id;

  if (resolvedId !== userId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const summary = await getOwnerBillingSummary(userId);
  if (!summary) {
    return NextResponse.json({ error: "Could not load billing." }, { status: 500 });
  }

  return NextResponse.json(summary);
}
