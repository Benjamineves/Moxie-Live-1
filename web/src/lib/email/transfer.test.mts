/**
 * Buyer-facing transfer emails.
 *
 * These go to an address a third party typed in — someone who never
 * signed up and may not know Moxie exists. That makes the bar higher
 * than for account mail: it has to be obviously legitimate, obviously
 * about them, and obviously ignorable.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  renderTransferInvitationHtml,
  renderTransferInvitationText,
  transferInvitationSubject,
  renderTransferExpiryReminderHtml,
  transferExpiryReminderSubject,
} from "./transfer.ts";
import { TRANSFER_EXPIRY_DAYS } from "../vessel-transfer.ts";

const INPUT = {
  acceptUrl: "https://moxieyacht.com/transfer/accept?token=abc123",
  mxeId: "MXE-01015",
  vesselName: "Second Wind",
  sellerName: "Ben Eves",
  sellerEmail: "ben@hevel.co",
  expiresOn: "September 18, 2026",
};

const html = renderTransferInvitationHtml(INPUT);
const text = renderTransferInvitationText(INPUT);

/**
 * The three facts a stranger needs to tell this from phishing: which
 * vessel, who started it, and when it dies. All three in the subject or
 * the first screen.
 */
test("the invitation names the vessel, the initiator and the deadline", () => {
  for (const body of [html, text]) {
    assert.ok(body.includes("Second Wind"), "vessel name missing");
    assert.ok(body.includes("MXE-01015"), "MXE ID missing");
    assert.ok(body.includes("Ben Eves"), "initiator name missing");
    assert.ok(body.includes("ben@hevel.co"), "initiator email missing");
    assert.ok(body.includes("September 18, 2026"), "expiry date missing");
  }
  const subject = transferInvitationSubject(INPUT);
  assert.ok(subject.includes("Second Wind") && subject.includes("Ben Eves"));
});

test("the accept link appears as a button and as pasteable text", () => {
  assert.ok(html.includes(`href="${INPUT.acceptUrl}"`), "no button link");
  assert.ok(html.includes("paste this into your browser"), "no fallback URL");
  // The token must survive untouched — an escaped or mangled one is a
  // dead link the recipient cannot recover from.
  assert.equal(html.split(INPUT.acceptUrl).length - 1, 2);
});

test("it tells the recipient they can ignore it", () => {
  // They did not ask for this. A message that offers no way out reads as
  // pressure, and pressure reads as a scam.
  for (const body of [html, text]) {
    assert.ok(body.includes("you can ignore it"), "no opt-out sentence");
    assert.ok(body.includes(String(TRANSFER_EXPIRY_DAYS)), "does not state the expiry window");
  }
});

test("the footer explains how they came to be emailed", () => {
  assert.ok(html.includes("the current owner of this vessel started a transfer to your email address"));
});

test("a vessel with no name falls back to the MXE ID alone", () => {
  const unnamed = renderTransferInvitationText({ ...INPUT, vesselName: null });
  assert.ok(unnamed.includes("MXE-01015"));
  assert.ok(!unnamed.includes("null"), "a missing name must not print as null");
});

test("an unknown seller degrades to a neutral description", () => {
  const anon = renderTransferInvitationText({ ...INPUT, sellerName: null, sellerEmail: null });
  assert.ok(anon.includes("the current owner"));
  assert.ok(!anon.includes("null"));
});

test("a vessel name with markup in it is escaped", () => {
  const nasty = renderTransferInvitationHtml({ ...INPUT, vesselName: `<script>alert(1)</script>` });
  assert.ok(!nasty.includes("<script>"), "raw markup from a vessel name reached the email");
  assert.ok(nasty.includes("&lt;script&gt;"));
});

test("the plain-text alternative is real text", () => {
  assert.ok(!/<[a-z]/i.test(text), "markup leaked into the text part");
  const lines = text.split("\n");
  const urlLine = lines.findIndex((l) => l.startsWith("https://"));
  assert.ok(urlLine > 0 && !lines[urlLine].endsWith("."), "URL must stand alone with no trailing stop");
});

/**
 * Built for stage 4 and wired to nothing. The test exists so the copy
 * cannot rot before a scheduler arrives to use it.
 */
test("the pre-expiry reminder renders and reads correctly near the deadline", () => {
  assert.ok(transferExpiryReminderSubject({ ...INPUT, daysLeft: 2 }).includes("in 2 days"));
  assert.ok(transferExpiryReminderSubject({ ...INPUT, daysLeft: 1 }).includes("tomorrow"), "1 must not read '1 days'");
  const reminder = renderTransferExpiryReminderHtml({ ...INPUT, daysLeft: 2 });
  assert.ok(reminder.startsWith("<!DOCTYPE html>"));
  assert.ok(reminder.includes(INPUT.acceptUrl));
  assert.ok(reminder.includes("the vessel stays with its current owner"));
});
