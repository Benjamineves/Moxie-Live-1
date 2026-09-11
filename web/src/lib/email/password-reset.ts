/**
 * Password reset — the one email Moxie sends today.
 *
 * Rendered by SUPABASE, not by this app: it is pasted into the
 * dashboard's Auth email templates. That makes the variables Go template
 * syntax, and makes `{{ .ConfirmationURL }}` a literal string that must
 * survive into the output untouched — it is not a value this code
 * substitutes.
 *
 * Because Supabase holds the copy that actually sends, the generated
 * file under docs/email/ says so at the top. The dashboard is a paste
 * target; this module is the source.
 */
import { button, fallbackUrl, notice, paragraph, renderEmailLayout } from "./layout.ts";
import { renderPlainText } from "./plain-text.ts";

/**
 * Supabase substitutes this before sending. It must appear verbatim,
 * spaces included — `{{.ConfirmationURL}}` is a different token to Go's
 * parser in some versions, and a typo here produces an email with a dead
 * link that looks perfectly fine in review.
 */
export const SUPABASE_CONFIRMATION_URL = "{{ .ConfirmationURL }}";

export const PASSWORD_RESET_SUBJECT = "Reset your Moxie password";

const FOOTER_REASON = "Sent by Moxie because someone requested a password reset for this address.";

export function renderPasswordResetHtml(): string {
  return renderEmailLayout({
    subject: PASSWORD_RESET_SUBJECT,
    headerLabel: "Account",
    title: "Reset your password",
    intro: [
      paragraph(
        "We received a request to reset the password for your Moxie account. Choose a new one using the button below.",
      ),
      paragraph("This link expires in one hour and can only be used once.", { last: true }),
    ],
    blocks: [
      button(SUPABASE_CONFIRMATION_URL, "Choose a new password"),
      fallbackUrl(SUPABASE_CONFIRMATION_URL),
      // Kept as its own block rather than folded into the body: someone
      // who did NOT request this is the reader most likely to be alarmed,
      // and the sentence that calms them should not be buried in a
      // paragraph they have already stopped reading.
      notice(
        `Didn't request this? You can ignore this message &mdash; your password won't change unless you use the link above.`,
      ),
    ],
    footerReason: FOOTER_REASON,
  });
}

export function renderPasswordResetText(): string {
  return renderPlainText({
    title: "Reset your password",
    paragraphs: [
      "We received a request to reset the password for your Moxie account.",
      "This link expires in one hour and can only be used once.",
    ],
    action: { label: "Choose a new password", url: SUPABASE_CONFIRMATION_URL },
    closing: [
      "Didn't request this? You can ignore this message - your password won't change unless you use the link above.",
    ],
    footerReason: FOOTER_REASON,
  });
}
