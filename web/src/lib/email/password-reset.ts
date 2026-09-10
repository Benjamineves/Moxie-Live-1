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

/**
 * Supabase's template editor takes one HTML body and has no field for a
 * text/plain alternative, so the plain text cannot be pasted alongside
 * it. It is generated anyway, for two reasons: it is the copy to use the
 * moment sending moves to a real provider, and it is what belongs in the
 * text part if Supabase ever exposes one.
 *
 * Until then the missing text part is a known deliverability weakness of
 * sending through Supabase Auth, not something this file forgot.
 */
export function passwordResetPasteNote(): string {
  return [
    "<!--",
    "  MOXIE — PASSWORD RESET EMAIL",
    "",
    "  PASTE TARGET, NOT SOURCE OF TRUTH.",
    "",
    "  This file is generated from web/src/lib/email/password-reset.ts by",
    "  scripts/generate-email-templates.mjs. Paste it into the Supabase",
    "  dashboard under Authentication > Emails > Reset Password.",
    "",
    "  Do not edit it here, and do not edit it in the Supabase dashboard.",
    "  Edit the module and regenerate:",
    "",
    "      node scripts/generate-email-templates.mjs",
    "",
    "  A change made only in the dashboard is invisible to this repository",
    "  and will be silently overwritten by the next paste.",
    "",
    "  {{ .ConfirmationURL }} is Supabase's own Go template variable. It is",
    "  substituted at send time and must survive verbatim — do not encode",
    "  it, wrap it, or replace it with a real URL.",
    "",
    `  Subject line to set alongside it:  ${PASSWORD_RESET_SUBJECT}`,
    "",
    "  Supabase has no field for a text/plain alternative, so the plain-text",
    "  version (docs/email/password_reset.txt) cannot be pasted with it.",
    "  That missing part is a known spam signal and is the reason to move",
    "  sending to a real provider; it is not an omission in this file.",
    "-->",
  ].join("\n");
}

/** What actually gets written to docs/email/. */
export function renderPasswordResetPasteFile(): string {
  return `${passwordResetPasteNote()}\n${renderPasswordResetHtml()}`;
}
