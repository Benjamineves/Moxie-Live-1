/**
 * Renders the email templates to docs/email/.
 *
 *   npm run email:build
 *
 * The generated .html files are PURE HTML with no comment header, because
 * they exist to be selected whole and pasted into a Body box. A note at
 * the top would be pasted along with everything else, so the provenance
 * lives in docs/email/README.md instead.
 *
 * Edit the modules under src/lib/email/, never the output.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  renderPasswordResetHtml,
  renderPasswordResetText,
  PASSWORD_RESET_SUBJECT,
} from "../src/lib/email/password-reset.ts";
import {
  renderExpiryReminderHtml,
  renderExpiryReminderText,
  expiryReminderSubject,
} from "../src/lib/email/expiry-reminder.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(HERE, "../../docs/email");

/**
 * The sample the reminder renders with. Matches the mockup's example so
 * the generated file can be held next to
 * docs/design/moxie_email_templates.html and compared directly.
 */
const SAMPLE = {
  vesselName: "Second Wind",
  mxeId: "MXE-01015",
  docType: "insurance",
  expiryDate: "Oct 10, 2026",
  daysRemaining: 30,
  baseUrl: "https://moxieyacht.com",
};

const README = `# Moxie email templates

**Generated. Do not edit anything in this folder.**

Source: \`web/src/lib/email/\`. Rebuild with:

    npm run email:build

---

## supabase_password_reset.html — paste target

Pure HTML, no comment header, so it can be selected whole and pasted.

**Supabase dashboard → Authentication → Emails → Reset Password.**
Paste the entire file into the **Body (HTML)** box.

Subject line to set alongside it:

    ${PASSWORD_RESET_SUBJECT}

On macOS, straight to the clipboard:

    cat docs/email/supabase_password_reset.html | pbcopy

### Things that will break it

- \`{{ .ConfirmationURL }}\` is Supabase's own Go template variable, substituted
  at send time. It must survive verbatim — do not encode it, wrap it in quotes,
  or replace it with a real URL. It appears twice: the button's \`href\` and the
  visible fallback URL beneath it.
- **Supabase is a paste target, not the source of truth.** A change made only in
  the dashboard is invisible to this repository and will be silently overwritten
  by the next paste. Edit the module and regenerate.

### Known gap

Supabase's editor has one Body box and no field for a \`text/plain\`
alternative, so \`password_reset.txt\` **cannot** be pasted alongside it. The
reset therefore sends as single-part HTML, which is a documented spam signal and
contributed to it landing in spam previously. The text part is ready for the day
sending moves to a real provider; it is not an omission.

---

## expiry_reminder.html — sample render, not wired to anything

There is no scheduler and no sender. This is a preview of what the template
produces, rendered with the mockup's own example values so it can be compared
side by side with \`docs/design/moxie_email_templates.html\`.

Subject line it would use:

    ${expiryReminderSubject(SAMPLE)}

Nothing in the application may promise reminders until sending exists. This
template existing is not permission to reference it in app copy.

---

## Files

| File | What it is |
|---|---|
| \`supabase_password_reset.html\` | Paste into Supabase. Pure HTML. |
| \`password_reset.txt\` | Plain-text alternative. Nowhere to paste it yet. |
| \`expiry_reminder.html\` | Sample render. Not wired to anything. |
| \`expiry_reminder.txt\` | Plain-text alternative for the same. |
`;

await mkdir(OUT, { recursive: true });

const files = [
  ["supabase_password_reset.html", renderPasswordResetHtml()],
  ["password_reset.txt", `Subject: ${PASSWORD_RESET_SUBJECT}\n\n${renderPasswordResetText()}`],
  ["expiry_reminder.html", renderExpiryReminderHtml(SAMPLE)],
  ["expiry_reminder.txt", `Subject: ${expiryReminderSubject(SAMPLE)}\n\n${renderExpiryReminderText(SAMPLE)}`],
  ["README.md", README],
];

for (const [name, contents] of files) {
  await writeFile(resolve(OUT, name), contents);
  console.log(`wrote docs/email/${name} (${contents.length} bytes)`);
}
