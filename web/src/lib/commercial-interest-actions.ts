"use server";

import { createHash } from "node:crypto";
import { headers } from "next/headers";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { checkRateLimit } from "@/lib/rate-limit";
import { sendEmail } from "@/lib/email/send";
import {
  BUSINESS_TYPE_LABELS,
  isBusinessType,
  looksLikeEmail,
  recordCommercialInterest,
  type BusinessType,
} from "@/lib/commercial-interest";

/**
 * The /pricing commercial-interest form's one action.
 *
 * UNAUTHENTICATED, WRITES, AND SENDS MAIL — so it is an abuse target, and
 * it has three layers: a honeypot, an in-memory per-IP gate, and the RPC's
 * own per-IP limit in the database (5/hour, 20/day), which is the one that
 * actually holds across serverless instances.
 *
 * The row is the record. The email to Ben is best-effort on top and never
 * decides the outcome, exactly as notifyOwner treats Resend — and a
 * duplicate submission doesn't send one at all, because `created` is false.
 */

const NOTIFY_TO = "admin@moxieyachting.com";

export type InterestState =
  | { status: "idle" }
  | { status: "done" }
  // The email comes back so a failed submit doesn't wipe what they typed.
  | { status: "error"; message: string; email: string };

/** Never the raw address: this is here to stop abuse, not to identify anyone. */
function hashIp(ip: string | null): string | null {
  if (!ip) return null;
  return createHash("sha256").update(`moxie-commercial-interest:${ip}`).digest("hex").slice(0, 32);
}

export async function submitCommercialInterest(_prev: InterestState, form: FormData): Promise<InterestState> {
  // Honeypot: a field no person sees, that a form-filling bot completes.
  // Answer as if it worked — telling a bot it was caught only teaches it.
  if (String(form.get("company_website") ?? "").trim() !== "") return { status: "done" };

  const email = String(form.get("email") ?? "").trim();
  const rawType = String(form.get("business_type") ?? "").trim();
  const businessType: BusinessType | null = isBusinessType(rawType) ? rawType : null;
  const sourcePage = String(form.get("source_page") ?? "/pricing").slice(0, 200);

  if (!looksLikeEmail(email)) {
    return { status: "error", message: "That doesn't look like an email address.", email };
  }

  const headerList = await headers();
  const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
  const ipHash = hashIp(ip);

  // Cheap first gate. Per-process memory, so it stops one script on one
  // instance and nothing more — the RPC's limit is the real one.
  if (ipHash && !checkRateLimit(`commercial-interest:${ipHash}`, { max: 5, windowMs: 60 * 60_000 })) {
    return { status: "error", message: "Too many submissions from this connection. Try again later.", email };
  }

  const service = requireSupabaseServiceClient("lib/commercial-interest-actions");

  // Deploy order: this ships whether or not 20261009 has run. A missing RPC
  // (PGRST202), or anything else unexpected, must not throw an unhandled
  // error at someone filling in a form — and must never report success for
  // a row that wasn't written.
  let result;
  try {
    result = await recordCommercialInterest(service, { email, businessType, sourcePage, ipHash });
  } catch (err) {
    console.error("[commercial-interest] submission failed:", err);
    return { status: "error", message: "Something went wrong at our end. Try again in a minute.", email };
  }

  if (!result.ok) {
    if (result.refusal === "rate_limited") {
      return { status: "error", message: "Too many submissions from this connection. Try again later.", email };
    }
    // unknown_type can only come from a hand-made request; invalid_email is
    // already caught above. Either way, say the useful thing.
    return { status: "error", message: "That doesn't look like an email address.", email };
  }

  if (result.created) {
    const type = businessType ? BUSINESS_TYPE_LABELS[businessType] : "not given";
    try {
      await sendEmail({
        to: NOTIFY_TO,
        subject: `Commercial interest: ${email}`,
        text: `${email}\nBusiness type: ${type}\nFrom: ${sourcePage}\n\nThe full list: https://moxieyacht.com/admin/commercial-interest`,
        html:
          `<p><strong>${email}</strong></p><p>Business type: ${type}<br>From: ${sourcePage}</p>` +
          `<p><a href="https://moxieyacht.com/admin/commercial-interest">The full list</a></p>`,
      });
    } catch (err) {
      // The row is already written; a failed notification must not tell
      // someone their signup failed.
      console.error("[commercial-interest] notification email failed:", err);
    }
  }

  return { status: "done" };
}
