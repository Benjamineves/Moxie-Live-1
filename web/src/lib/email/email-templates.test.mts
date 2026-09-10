/**
 * Guards for the two email templates.
 *
 * Emails are the least testable surface in the product — they render in
 * clients nobody here controls, and a mistake is discovered by a customer
 * who cannot complete a password reset. These cover the failures that are
 * checkable from here and would otherwise be found in an inbox.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  SUPABASE_CONFIRMATION_URL,
  renderPasswordResetHtml,
  renderPasswordResetText,
} from "./password-reset.ts";
import {
  renderExpiryReminderHtml,
  renderExpiryReminderText,
  expiryReminderSubject,
  EXPIRY_DOC_LABELS,
} from "./expiry-reminder.ts";
import { EXPIRY_DOC_TYPES } from "../document-expiry.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const reset = renderPasswordResetHtml();

const SAMPLE = {
  vesselName: "Second Wind",
  mxeId: "MXE-01015",
  docType: "insurance" as const,
  expiryDate: "Oct 10, 2026",
  daysRemaining: 30,
  baseUrl: "https://moxieyacht.com",
};
const reminder = renderExpiryReminderHtml(SAMPLE);

/**
 * THE ONE THAT MATTERS MOST.
 *
 * Supabase substitutes this at send time. If it is escaped, renamed, or
 * loses its spaces, the email still renders perfectly in review and its
 * link is dead for every recipient.
 */
test("the reset carries Supabase's variable verbatim, unescaped", () => {
  assert.equal(SUPABASE_CONFIRMATION_URL, "{{ .ConfirmationURL }}");
  assert.ok(reset.includes(`href="${SUPABASE_CONFIRMATION_URL}"`), "button href must be the raw variable");
  assert.ok(!reset.includes("%7B%7B"), "the variable must not be URL-encoded");
  assert.ok(!reset.includes("&#123;"), "the variable must not be HTML-escaped");
  // Once in the button, once as the visible fallback URL.
  assert.equal(reset.split(SUPABASE_CONFIRMATION_URL).length - 1, 2);
});

test("the reset offers the URL as text as well as a button", () => {
  assert.ok(reset.includes("paste this into your browser"));
  assert.ok(reset.includes("word-break:break-all"), "a long URL must not widen the table");
});

test("no mockup placeholder survives into either template", () => {
  for (const [name, html] of [["reset", reset], ["reminder", reminder]] as const) {
    assert.ok(!html.includes('href="#"'), `${name} still has a # placeholder link`);
  }
});

test("neither template uses anything email clients strip", () => {
  for (const [name, html] of [["reset", reset], ["reminder", reminder]] as const) {
    for (const banned of ["<style", "<link", "@media", "display:flex", "<svg", "<img"]) {
      assert.ok(!html.includes(banned), `${name} contains ${banned}, which will not survive`);
    }
    assert.ok(html.includes("max-width:600px"), `${name} lost its width cap`);
    assert.ok(html.includes("Georgia"), `${name} lost the display fallback`);
  }
});

test("the wordmark is styled text in brand colours, not an image", () => {
  for (const html of [reset, reminder]) {
    assert.ok(html.includes(`<span style="color:#c9a84c;">M</span>oxie<span style="color:#17c3b2;">.</span>`));
  }
});

test("each template carries its own header label", () => {
  assert.ok(reset.includes(">\n            Account\n"), "reset header should read Account");
  assert.ok(reminder.includes("MXE-01015"), "reminder header should carry the MXE ID");
});

/**
 * Vessel names are owner-supplied and reach an email we send in our own
 * name. An unescaped one is broken markup at best and injected HTML at
 * worst.
 */
test("a vessel name with markup in it is escaped", () => {
  const nasty = renderExpiryReminderHtml({
    ...SAMPLE,
    vesselName: `<script>alert(1)</script> & "quotes"`,
  });
  assert.ok(!nasty.includes("<script>"), "raw script tag reached the email body");
  assert.ok(nasty.includes("&lt;script&gt;"));
  assert.ok(nasty.includes("&amp;"));
});

/**
 * The mockup's footer offered to manage reminders in vessel settings.
 * That control does not exist, and the app-wide rule is that nothing may
 * promise a capability that has no implementation.
 */
test("the reminder promises no opt-out that does not exist", () => {
  const text = renderExpiryReminderText(SAMPLE);
  for (const phrase of ["Manage reminders", "vessel settings", "unsubscribe", "preferences"]) {
    assert.ok(!reminder.includes(phrase), `reminder HTML still offers "${phrase}"`);
    assert.ok(!text.includes(phrase), `reminder text still offers "${phrase}"`);
  }
  // The half of that footer that IS true stays.
  assert.ok(reminder.includes("you added an expiry date for this document"));
});

test("both templates say why the recipient received them", () => {
  assert.ok(reset.includes("Sent by Moxie because someone requested a password reset"));
  // The apostrophe arrives as &#39; because the footer sentence is a
  // plain string and goes through escapeHtml, which is correct — it
  // renders as an apostrophe and would escape a stray tag too.
  assert.ok(reminder.includes("receiving this because"));
  assert.ok(reminder.includes("You&#39;re"), "footer text should be escaped, not raw");
});

test("the reminder links at the vessel's own documents page", () => {
  assert.ok(reminder.includes("https://moxieyacht.com/dashboard/MXE-01015/documents"));
});

test("the heading reads correctly at every distance from expiry", () => {
  const at = (daysRemaining: number) => expiryReminderSubject({ ...SAMPLE, daysRemaining });
  assert.ok(at(30).startsWith("Insurance expires in 30 days"));
  assert.ok(at(1).startsWith("Insurance expires tomorrow"), "1 day must not read '1 days'");
  assert.ok(at(0).startsWith("Insurance expires today"));
  assert.ok(at(-3).startsWith("Insurance has expired"), "a past date must not read 'expires in -3 days'");
});

test("every expiring document type has a label", () => {
  // Reusing the app's union means a new expiring document type breaks
  // this test rather than sending an email with a blank document name.
  for (const docType of EXPIRY_DOC_TYPES) {
    assert.ok(EXPIRY_DOC_LABELS[docType], `no email label for ${docType}`);
  }
});

/**
 * A missing text/plain part is a real spam signal, and its absence
 * contributed to the reset landing in spam. These assert the alternative
 * exists and is usable, not merely present.
 */
test("plain text carries the link alone on its line", () => {
  for (const text of [renderPasswordResetText(), renderExpiryReminderText(SAMPLE)]) {
    const lines = text.split("\n");
    const urlLine = lines.findIndex((l) => l.startsWith("http") || l.startsWith("{{"));
    assert.ok(urlLine > 0, "no URL line found");
    assert.equal(lines[urlLine], lines[urlLine].trim(), "URL line must not be indented");
    assert.ok(!lines[urlLine].endsWith("."), "a trailing stop gets swallowed into the link");
  }
});

test("plain text contains no markup", () => {
  for (const text of [renderPasswordResetText(), renderExpiryReminderText(SAMPLE)]) {
    assert.ok(!/<[a-z]/i.test(text), "HTML leaked into the plain-text alternative");
    assert.ok(!text.includes("&amp;"), "HTML entities leaked into the plain-text alternative");
  }
});

/**
 * The generated files are what actually gets pasted. If they drift from
 * the modules, the thing in the dashboard is not the thing under review.
 */
test("the generated paste file is current", () => {
  const generated = readFileSync(resolve(HERE, "../../../../docs/email/supabase_password_reset.html"), "utf8");
  assert.ok(
    generated.includes(renderPasswordResetHtml().trim()),
    "docs/email/supabase_password_reset.html is stale — run npm run email:build",
  );
  assert.ok(generated.includes("PASTE TARGET, NOT SOURCE OF TRUTH"));
});
