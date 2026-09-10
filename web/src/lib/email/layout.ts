/**
 * Shared layout for every Moxie email.
 *
 * Source of truth: docs/design/moxie_email_templates.html. Layout,
 * spacing and colour values come from that mockup — if the two ever
 * disagree, the mockup is right and this is wrong.
 *
 * WHY IT LOOKS LIKE 1999
 *
 * Tables, inline styles, no stylesheet, no media queries, no flexbox.
 * Not nostalgia: Outlook renders through Word's HTML engine, Gmail
 * strips <style> blocks in several contexts, and every layout system
 * newer than the table is unreliable across the set of clients real
 * customers actually use. 600px is the width that survives the narrowest
 * common reading pane.
 *
 * NO WEB FONTS, NO IMAGES
 *
 * @font-face is ignored by most clients, so the display face is Georgia
 * — a serif that is genuinely present on Windows, macOS and iOS rather
 * than a hopeful first choice. And the wordmark is styled TEXT, never an
 * SVG or a hosted image: images are blocked by default in many clients,
 * and branding that vanishes behind a blocked-image placeholder is
 * branding that does not work. Gold M, white "oxie", aqua dot — the same
 * mark the app header draws.
 */

export const EMAIL_COLORS = {
  navy: "#0d1f35",
  gold: "#c9a84c",
  aqua: "#17c3b2",
  cream: "#f4f1ea",
  page: "#e8e4dc",
  white: "#ffffff",
  rule: "#e5e1d8",
  body: "#374151",
  muted: "#6b7280",
  mutedLight: "#9ca3af",
  noticeText: "#4b5563",
  warning: "#b45309",
} as const;

/** Georgia is the display face because email clients cannot load ours. */
export const SERIF = "Georgia,'Times New Roman',serif";
export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif";

/**
 * Every value interpolated into an email must go through this. Vessel
 * names, document labels and owner-supplied text all reach these
 * templates, and an unescaped apostrophe or angle bracket in a vessel
 * name is at best broken markup and at worst injected HTML in a message
 * we send in our own name.
 */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export type EmailBlock = string;

/** A body paragraph. `html` is inserted as-is — escape before calling. */
export function paragraph(html: string, { last = false }: { last?: boolean } = {}): EmailBlock {
  return `      <p style="margin:0 0 ${last ? 28 : 16}px 0;font-family:${SANS};font-size:15px;line-height:1.65;color:${EMAIL_COLORS.body};">
        ${html}
      </p>`;
}

/**
 * A real button — a background colour on the <td>, with the padding on
 * the <a> inside it. Outlook ignores padding on an anchor unless the
 * cell carries the fill, which is why it is built this way rather than
 * as a styled link.
 */
export function button(href: string, label: string): EmailBlock {
  return `  <tr>
    <td style="padding:0 32px 24px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td style="background:${EMAIL_COLORS.navy};border-radius:8px;">
            <a href="${href}" style="display:inline-block;padding:14px 30px;font-family:${SANS};font-size:14px;font-weight:600;letter-spacing:.03em;color:${EMAIL_COLORS.white};text-decoration:none;">
              ${escapeHtml(label)}
            </a>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

/**
 * The same destination again, as selectable text.
 *
 * Not redundancy. Some clients rewrite or break button markup, some
 * corporate gateways strip anchors entirely, and a recipient who cannot
 * click still has to be able to finish the task. word-break:break-all
 * stops a long URL forcing the whole table wider than 600px.
 */
export function fallbackUrl(url: string, lead = "If the button doesn't work, paste this into your browser:"): EmailBlock {
  return `  <tr>
    <td style="padding:0 32px 30px 32px;">
      <p style="margin:0 0 6px 0;font-family:${SANS};font-size:13px;line-height:1.6;color:${EMAIL_COLORS.muted};">
        ${escapeHtml(lead)}
      </p>
      <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.5;color:${EMAIL_COLORS.muted};word-break:break-all;">
        ${url}
      </p>
    </td>
  </tr>`;
}

/** The cream reassurance box. */
export function notice(html: string): EmailBlock {
  return `  <tr>
    <td style="padding:0 32px 34px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL_COLORS.cream};border-radius:8px;">
        <tr>
          <td style="padding:16px 18px;font-family:${SANS};font-size:13px;line-height:1.6;color:${EMAIL_COLORS.noticeText};">
            ${html}
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export type DetailRow = { label: string; value: string; emphasis?: boolean };

/** The cream label/value card. Values are escaped here. */
export function detailCard(rows: DetailRow[]): EmailBlock {
  const cells = rows
    .map((row, i) => {
      const pad = i === rows.length - 1 ? "" : "padding-bottom:10px;";
      const valueStyle = row.emphasis
        ? `font-weight:600;color:${EMAIL_COLORS.warning};`
        : `color:${EMAIL_COLORS.navy};`;
      return `              <tr>
                <td style="${pad}font-family:${SANS};font-size:11px;letter-spacing:.16em;text-transform:uppercase;color:${EMAIL_COLORS.muted};">${escapeHtml(row.label)}</td>
                <td align="right" style="${pad}font-family:${SANS};font-size:14px;${valueStyle}">${escapeHtml(row.value)}</td>
              </tr>`;
    })
    .join("\n");

  return `  <tr>
    <td style="padding:0 32px 28px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${EMAIL_COLORS.cream};border-radius:8px;">
        <tr>
          <td style="padding:18px 20px;">
            <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
${cells}
            </table>
          </td>
        </tr>
      </table>
    </td>
  </tr>`;
}

export type EmailLayoutInput = {
  /** <title>, and the hidden preview line. */
  subject: string;
  /**
   * The small uppercase label at the right of the header — "Account" on
   * the reset, the MXE ID on the reminder.
   */
  headerLabel: string;
  /** The italic serif heading. */
  title: string;
  /** Body paragraphs, already escaped. */
  intro: EmailBlock[];
  /** Everything after the intro: buttons, cards, notices, in order. */
  blocks: EmailBlock[];
  /**
   * The plain sentence saying why this message arrived. Every email
   * carries one — a recipient who cannot tell why they received
   * something reports it as spam, and they are right to.
   */
  footerReason: string;
};

export function renderEmailLayout(input: EmailLayoutInput): string {
  const { subject, headerLabel, title, intro, blocks, footerReason } = input;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:32px 16px;background:${EMAIL_COLORS.page};font-family:${SERIF};">

<!-- Preview text: what the inbox list shows beside the subject. Hidden
     in the message itself, and followed by non-breaking spaces so the
     client does not pull body copy in after it. -->
<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;">${escapeHtml(subject)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="max-width:600px;margin:0 auto;background:${EMAIL_COLORS.white};border-radius:12px;overflow:hidden;">

  <!-- header -->
  <tr>
    <td style="background:${EMAIL_COLORS.navy};padding:22px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
        <tr>
          <td style="font-family:${SERIF};font-size:22px;font-style:italic;color:${EMAIL_COLORS.white};">
            <span style="color:${EMAIL_COLORS.gold};">M</span>oxie<span style="color:${EMAIL_COLORS.aqua};">.</span>
          </td>
          <td align="right" style="font-family:${SANS};font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:rgba(255,255,255,.45);">
            ${escapeHtml(headerLabel)}
          </td>
        </tr>
      </table>
    </td>
  </tr>

  <!-- body -->
  <tr>
    <td style="padding:38px 32px 8px 32px;">
      <h1 style="margin:0 0 18px 0;font-family:${SERIF};font-size:27px;font-weight:normal;font-style:italic;color:${EMAIL_COLORS.navy};line-height:1.25;">
        ${escapeHtml(title)}
      </h1>
${intro.join("\n")}
    </td>
  </tr>

${blocks.join("\n")}

  <!-- footer -->
  <tr>
    <td style="background:${EMAIL_COLORS.cream};padding:22px 32px;border-top:1px solid ${EMAIL_COLORS.rule};">
      <p style="margin:0 0 6px 0;font-family:${SANS};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.muted};">
        ${escapeHtml(footerReason)}
      </p>
      <p style="margin:0;font-family:${SANS};font-size:12px;line-height:1.6;color:${EMAIL_COLORS.mutedLight};">
        moxieyacht.com &middot; Reply to this email to reach us.
      </p>
    </td>
  </tr>
</table>

</body>
</html>
`;
}
