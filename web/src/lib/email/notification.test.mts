/**
 * The notification email policy and copy.
 *
 * The policy map is a product decision that will be revisited, so the
 * tests state what it currently says rather than merely that it is
 * well-formed — a change to who gets emailed should have to be made
 * deliberately, in two places, by someone who meant it.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { NOTIFICATION_POLICY, type NotificationType } from "../notification-policy.ts";
import {
  notificationSubject,
  renderNotificationEmailHtml,
  renderNotificationEmailText,
  type EmailableNotificationType,
} from "./notification.ts";
import { DORMANCY } from "../tier-config.ts";

const ALL: NotificationType[] = [
  "subscription_past_due",
  "vessel_lapsed",
  "downgrade_grace_started",
  "vessel_locked",
  "vessel_reactivated",
  "transfer_accepted",
  "transfer_declined_or_expired",
  "transfer_completed_seller",
  "transfer_completed_buyer",
];

const EMAILING: EmailableNotificationType[] = ALL.filter(
  (t): t is EmailableNotificationType => t !== "vessel_reactivated",
);

const DAY = 24 * 60 * 60 * 1000;

test("every notification type has a policy", () => {
  // Record<NotificationType, …> makes this a compile error too, but a
  // runtime check catches a type widened without the map being updated.
  for (const type of ALL) {
    assert.ok(NOTIFICATION_POLICY[type], `no policy for ${type}`);
    assert.ok(NOTIFICATION_POLICY[type].why.length > 20, `${type} has no stated reasoning`);
  }
  assert.equal(Object.keys(NOTIFICATION_POLICY).length, ALL.length, "policy map has an entry for an unknown type");
});

test("four types email and vessel_reactivated does not", () => {
  for (const type of EMAILING) {
    assert.equal(NOTIFICATION_POLICY[type].email, true, `${type} should email`);
  }
  assert.equal(
    NOTIFICATION_POLICY.vessel_reactivated.email,
    false,
    "reactivation fires while the owner is watching it happen; emailing it is noise",
  );
});

test("account-level dedupe windows match the grace period each message quotes", () => {
  // The messages quote a fixed number of days. A repeat inside that
  // period would restate a figure that is no longer true, so the window
  // is the episode, not an arbitrary cooldown.
  assert.deepEqual(NOTIFICATION_POLICY.subscription_past_due.dedupe, {
    mode: "window",
    windowMs: DORMANCY.PAST_DUE_GRACE_DAYS * DAY,
  });
  assert.deepEqual(NOTIFICATION_POLICY.downgrade_grace_started.dedupe, {
    mode: "window",
    windowMs: DORMANCY.DOWNGRADE_GRACE_DAYS * DAY,
  });
  assert.deepEqual(NOTIFICATION_POLICY.vessel_lapsed.dedupe, { mode: "window", windowMs: 7 * DAY });
  assert.deepEqual(NOTIFICATION_POLICY.vessel_locked.dedupe, { mode: "window", windowMs: 7 * DAY });
});

/**
 * The point of stage 3's dedupe change. A seller may cancel a transfer
 * and start another to the same buyer for the same vessel minutes later.
 * Under a time window the second transfer's emails would be suppressed
 * as duplicates of the first, which is wrong — it is a new episode, and
 * only the transfer id distinguishes it.
 */
test("every transfer type dedupes by key, never by a window", () => {
  for (const type of ALL) {
    if (!type.startsWith("transfer_")) continue;
    assert.deepEqual(
      NOTIFICATION_POLICY[type].dedupe,
      { mode: "key" },
      `${type} must key on the transfer, or a second transfer to the same buyer is wrongly suppressed`,
    );
  }
});

test("both sides of a completed transfer are separate types", () => {
  // Seller and buyer are opposite sides of one event and share almost no
  // useful sentence. Two types is what stops one message being addressed
  // to two audiences.
  assert.notEqual(
    notificationSubject("transfer_completed_seller"),
    notificationSubject("transfer_completed_buyer"),
  );
  assert.ok(NOTIFICATION_POLICY.transfer_completed_seller.email);
  assert.ok(NOTIFICATION_POLICY.transfer_completed_buyer.email);
});

test("the buyer's completion email links at the vessel they were given", () => {
  const withVessel = renderNotificationEmailText({
    type: "transfer_completed_buyer",
    message: "x",
    mxeId: "MXE-01042",
  });
  assert.ok(withVessel.includes("https://moxieyacht.com/dashboard/MXE-01042"));

  // And degrades to the dashboard rather than a broken URL when the
  // lookup found nothing.
  const without = renderNotificationEmailText({ type: "transfer_completed_buyer", message: "x", mxeId: null });
  assert.ok(without.includes("https://moxieyacht.com/dashboard"));
  assert.ok(!without.includes("/dashboard/null"));
});

test("every emailing type has a distinct subject", () => {
  const subjects = EMAILING.map(notificationSubject);
  assert.equal(new Set(subjects).size, subjects.length, "two types share a subject line");
  for (const s of subjects) {
    assert.ok(s.length > 10 && s.length < 80, `subject out of range: "${s}"`);
    assert.ok(!s.endsWith("."), `subject should not end in a full stop: "${s}"`);
  }
});

test("every emailing type renders both parts", () => {
  for (const type of EMAILING) {
    const input = { type, message: "Something happened to your account.", mxeId: null };
    const html = renderNotificationEmailHtml(input);
    const text = renderNotificationEmailText(input);

    assert.ok(html.startsWith("<!DOCTYPE html>"), `${type} html is not a document`);
    assert.ok(html.includes("max-width:600px"), `${type} lost the layout`);
    assert.ok(html.includes(`<span style="color:#c9a84c;">M</span>oxie`), `${type} lost the wordmark`);
    assert.ok(html.includes("Sent by Moxie because"), `${type} must say why it arrived`);
    assert.ok(html.includes("https://moxieyacht.com/"), `${type} has no absolute CTA`);

    assert.ok(!/<[a-z]/i.test(text), `${type} text contains markup`);
    assert.ok(text.includes("https://moxieyacht.com/"), `${type} text has no link`);
  }
});

test("the banner line leads the email and is escaped", () => {
  const html = renderNotificationEmailHtml({
    type: "subscription_past_due",
    message: `Payment failed for <b>Second Wind</b> & co`,
    mxeId: null,
  });
  assert.ok(!html.includes("<b>Second Wind</b>"), "the banner line reached the body unescaped");
  assert.ok(html.includes("&lt;b&gt;Second Wind&lt;/b&gt;"));
});

test("a vessel-scoped email is labelled with its MXE ID", () => {
  const withVessel = renderNotificationEmailHtml({
    type: "vessel_locked",
    message: "Locked.",
    mxeId: "MXE-01042",
  });
  assert.ok(withVessel.includes("MXE-01042"), "header should carry the MXE ID when there is one");

  const accountLevel = renderNotificationEmailHtml({
    type: "subscription_past_due",
    message: "Payment failed.",
    mxeId: null,
  });
  assert.ok(accountLevel.includes("Account"), "header should fall back to Account");
});

test("the copy promises nothing the app cannot do", () => {
  // Reminders, alerts and notification preferences are all unbuilt. These
  // four emails describe events that have already happened, which is the
  // only thing safe to say.
  for (const type of EMAILING) {
    const input = { type, message: "x", mxeId: null };
    for (const html of [renderNotificationEmailHtml(input), renderNotificationEmailText(input)]) {
      for (const banned of ["we'll remind", "we will remind", "reminder", "unsubscribe", "notification preferences", "manage alerts"]) {
        assert.ok(
          !html.toLowerCase().includes(banned),
          `${type} promises "${banned}", which does not exist`,
        );
      }
    }
  }
});

test("CTAs point at routes that exist", () => {
  // /dashboard, /dashboard/upgrade and /dashboard/manage-fleet are all
  // real pages. A billing portal URL deliberately is not used here —
  // those are single-use and expire, so one in an email read tomorrow is
  // a dead link.
  const allowed = [
    "https://moxieyacht.com/dashboard",
    "https://moxieyacht.com/dashboard/upgrade",
    "https://moxieyacht.com/dashboard/manage-fleet",
  ];
  for (const type of EMAILING) {
    const text = renderNotificationEmailText({ type, message: "x", mxeId: null });
    const url = text.split("\n").find((l) => l.startsWith("https://"));
    assert.ok(url && allowed.includes(url), `${type} links at ${url}, which is not a known route`);
  }
});
