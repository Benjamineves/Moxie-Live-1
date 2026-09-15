import { NextResponse } from "next/server";
import { isAdminEmail } from "@/lib/admin-verify";
import { sendEmail } from "@/lib/email/send";
import { checkCronAuthorization } from "@/lib/scheduler/auth";
import { runScheduler } from "@/lib/scheduler/run";
import { MigrationNotRunError, createSupabaseBookkeeping, createSupabaseReads } from "@/lib/scheduler/store";
import { createStripeReads } from "@/lib/scheduler/stripe-reads";
import { getStripe } from "@/lib/stripe/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * The daily scheduler run. Invoked by Vercel cron (web/vercel.json) with
 * `Authorization: Bearer $CRON_SECRET`. docs/moxie_digital_scheduler_spec.md.
 *
 * Returns 500 for anything but a clean run, so the invocation shows red in
 * Vercel's cron log. Vercel doesn't retry cron invocations, so a 500 has no
 * side effect beyond being seen.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function GET(request: Request) {
  const auth = checkCronAuthorization(request.headers.get("authorization"), process.env.CRON_SECRET);
  if (auth === "unconfigured") {
    console.error("[scheduler] CRON_SECRET is not set — refusing to run.");
    return NextResponse.json({ error: "CRON_SECRET is not set; the scheduler will not run." }, { status: 500 });
  }
  if (auth !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    console.error("[scheduler] Supabase service role is not configured.");
    return NextResponse.json({ error: "Supabase service role is not configured." }, { status: 500 });
  }

  try {
    const result = await runScheduler({
      trigger: "cron",
      reads: createSupabaseReads(service),
      books: createSupabaseBookkeeping(service),
      stripe: createStripeReads(getStripe()),
      sendDigest: sendEmail,
      isCapExempt: isAdminEmail,
    });
    if (result.outcome === "overlap") {
      return NextResponse.json({ outcome: "overlap" }, { status: 200 });
    }
    return NextResponse.json(
      { outcome: result.outcome, run: result.runId, status: result.status, digest: result.digest, steps: result.summary.steps ?? null },
      { status: result.status === "succeeded" ? 200 : 500 },
    );
  } catch (err) {
    if (err instanceof MigrationNotRunError) {
      console.error(`[scheduler] ${err.message}`);
      return NextResponse.json({ error: err.message }, { status: 500 });
    }
    console.error("[scheduler] run threw before it could record itself:", err);
    return NextResponse.json({ error: "The scheduler run failed to start." }, { status: 500 });
  }
}
