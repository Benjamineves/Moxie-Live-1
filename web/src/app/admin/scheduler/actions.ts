"use server";

import { redirect } from "next/navigation";
import { isAdminEmail, requireAdmin } from "@/lib/admin-verify";
import { sendEmail } from "@/lib/email/send";
import { runScheduler } from "@/lib/scheduler/run";
import { MigrationNotRunError, createSupabaseBookkeeping, createSupabaseReads } from "@/lib/scheduler/store";
import { createStripeReads } from "@/lib/scheduler/stripe-reads";
import { getStripe } from "@/lib/stripe/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * "Run now" on /admin/scheduler. The same runScheduler the cron calls, with
 * trigger 'manual' — not a request to the cron route, so CRON_SECRET never
 * reaches a browser. Checked by requireAdmin here, in the action, not only
 * by the page that renders the button.
 */
export async function runSchedulerNow() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const service = requireSupabaseServiceClient("app/admin/scheduler/actions");
  let target = "/admin/scheduler";
  try {
    const result = await runScheduler({
      trigger: "manual",
      reads: createSupabaseReads(service),
      books: createSupabaseBookkeeping(service),
      stripe: createStripeReads(getStripe()),
      sendDigest: sendEmail,
      isCapExempt: isAdminEmail,
    });
    target = result.outcome === "overlap" ? "/admin/scheduler?error=overlap" : `/admin/scheduler?run=${encodeURIComponent(result.runId)}`;
  } catch (err) {
    console.error("[scheduler] manual run failed to start:", err);
    target = `/admin/scheduler?error=${err instanceof MigrationNotRunError ? "migration" : "start"}`;
  }
  redirect(target);
}
