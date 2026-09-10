/**
 * Renders the email templates to docs/email/.
 *
 *   npm run email:build
 *
 * The generated files exist because the places these actually send from
 * are not this repository: the password reset is pasted into the Supabase
 * dashboard, and the expiry reminder has no sender at all yet. Generating
 * them keeps a reviewable artifact in git and makes "what is live" a
 * paste rather than a rewrite.
 *
 * Edit the modules under src/lib/email/, never the output.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  renderPasswordResetPasteFile,
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

const REMINDER_NOTE = `<!--
  MOXIE — DOCUMENT EXPIRY REMINDER (SAMPLE RENDER)

  NOT WIRED TO ANYTHING. There is no scheduler and no sender. This file is
  a preview of what the template produces, generated from
  web/src/lib/email/expiry-reminder.ts by scripts/generate-email-templates.mjs.

  The values below are the mockup's example, so this can be compared
  side by side with docs/design/moxie_email_templates.html.

  Nothing in the application may promise reminders until sending exists.

  Subject line: ${expiryReminderSubject(SAMPLE)}
-->
`;

await mkdir(OUT, { recursive: true });

const files = [
  ["supabase_password_reset.html", renderPasswordResetPasteFile()],
  ["password_reset.txt", `Subject: ${PASSWORD_RESET_SUBJECT}\n\n${renderPasswordResetText()}`],
  ["expiry_reminder.html", `${REMINDER_NOTE}${renderExpiryReminderHtml(SAMPLE)}`],
  ["expiry_reminder.txt", `Subject: ${expiryReminderSubject(SAMPLE)}\n\n${renderExpiryReminderText(SAMPLE)}`],
];

for (const [name, contents] of files) {
  await writeFile(resolve(OUT, name), contents);
  console.log(`wrote docs/email/${name} (${contents.length} bytes)`);
}
