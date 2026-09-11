import { Resend } from "resend";

/**
 * The one place Moxie hands an email to Resend.
 *
 * Stage 1 verified send.moxieyacht.com and pointed Supabase's auth mail
 * at it over SMTP. This is the other half: the application's own
 * transactional mail, sent through Resend's API rather than relayed
 * through Supabase, so it can carry a real text/plain alternative
 * alongside the HTML. Supabase's editor has one Body box; the API takes
 * both, which is the difference between a multipart message and the
 * single-part HTML that helped the reset land in spam.
 *
 * NEVER THROWS. Callers are notification paths where the in-app row is
 * the source of truth — a provider having a bad minute must not take a
 * notification down with it.
 */

/**
 * On the verified subdomain, not the apex. Mail from a subdomain keeps
 * transactional reputation separate from anything the apex might send
 * later, and a reputation problem on one does not poison the other.
 */
export const EMAIL_FROM = "Moxie <notifications@send.moxieyacht.com>";

/**
 * Replies go somewhere a person reads. Every template's footer says
 * "reply to this email to reach us", and that has to be true — a
 * no-reply address under a footer inviting replies is a broken promise
 * and a spam signal in its own right.
 */
export const EMAIL_REPLY_TO = "admin@moxieyachting.com";

export type SendResult =
  | { sent: true; id: string | null }
  | { sent: false; reason: "disabled" | "error"; detail?: string };

let cached: Resend | null | undefined;

/**
 * Absent key means email is silently disabled rather than broken.
 * Preview deployments and local builds run the full notification path —
 * in-app rows, dedup, template rendering — and simply do not hand
 * anything to Resend at the end. Nobody's test signup mails a customer.
 */
function client(): Resend | null {
  if (cached !== undefined) return cached;
  const key = process.env.RESEND_API_KEY?.trim();
  cached = key ? new Resend(key) : null;
  return cached;
}

export function emailEnabled(): boolean {
  return client() !== null;
}

export async function sendEmail(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
}): Promise<SendResult> {
  const resend = client();
  if (!resend) return { sent: false, reason: "disabled" };

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      replyTo: EMAIL_REPLY_TO,
      to: input.to,
      subject: input.subject,
      html: input.html,
      // Both parts, always. A message sent as HTML alone reads to filters
      // as something a bulk sender produced.
      text: input.text,
    });

    if (error) return { sent: false, reason: "error", detail: error.message };
    return { sent: true, id: data?.id ?? null };
  } catch (err) {
    // Network failure, timeout, malformed key — all the same to the
    // caller, which is going to log and carry on either way.
    return { sent: false, reason: "error", detail: err instanceof Error ? err.message : "unknown error" };
  }
}
