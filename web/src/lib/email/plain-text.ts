/**
 * The plain-text half of every email.
 *
 * NOT AN AFTERTHOUGHT, AND THIS IS THE REASON.
 *
 * A message sent as HTML with no text/plain alternative is a documented
 * spam signal — filters read a single-part HTML body as something a
 * bulk sender produced rather than something a person would write. The
 * stock Supabase reset template ships without one, and that contributed
 * to Moxie's password reset landing in spam.
 *
 * So this is a real alternative, not a stripped-tags rendering of the
 * HTML: the same information, written to be read as text, with the URL
 * on its own line where every client will linkify it.
 */

export type PlainTextInput = {
  title: string;
  paragraphs: string[];
  /** Label then URL, on separate lines. */
  action?: { label: string; url: string };
  /** "Vessel: Second Wind" style lines. */
  details?: { label: string; value: string }[];
  /** Anything after the action — the "didn't request this" line. */
  closing?: string[];
  footerReason: string;
};

const RULE = "-".repeat(56);

export function renderPlainText(input: PlainTextInput): string {
  const { title, paragraphs, action, details, closing, footerReason } = input;
  const out: string[] = ["MOXIE", "", title.toUpperCase(), ""];

  for (const p of paragraphs) out.push(p, "");

  if (details?.length) {
    for (const d of details) out.push(`${d.label}: ${d.value}`);
    out.push("");
  }

  if (action) {
    // Label, then the bare URL alone on its line. Clients linkify a URL
    // that starts a line far more reliably than one wrapped in prose,
    // and nothing must be appended after it — a trailing full stop gets
    // swallowed into the link and breaks it.
    out.push(`${action.label}:`, action.url, "");
  }

  if (closing?.length) {
    for (const c of closing) out.push(c, "");
  }

  out.push(RULE, footerReason, "moxieyacht.com — reply to this email to reach us.", "");

  return out.join("\n");
}
