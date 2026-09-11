/**
 * Email bodies for the notifications the app itself raises.
 *
 * The `message` strings notifyOwner already carries are written for a
 * banner: one sentence, present tense, read at a glance by someone who
 * is already looking at the dashboard. An email reaches someone who is
 * not, may be read days later, and has to say what happened, what it
 * means, and what to do. So each type gets its own subject and body
 * rather than wrapping the banner line in a template.
 *
 * Built on the stage 1 layout, so these share the header, wordmark,
 * footer and plain-text treatment with the password reset.
 */
import { button, notice, paragraph, renderEmailLayout, escapeHtml } from "./layout.ts";
import { renderPlainText } from "./plain-text.ts";
import { DORMANCY } from "../tier-config.ts";
import type { EmailableNotificationType } from "../notification-policy.ts";

export type { EmailableNotificationType };

export type NotificationEmailInput = {
  type: EmailableNotificationType;
  /** The banner line. Used as the lead paragraph; already plain text. */
  message: string;
  /** Header label — the vessel's MXE ID when the event is vessel-scoped. */
  mxeId?: string | null;
  baseUrl?: string;
};

type Copy = {
  subject: string;
  title: string;
  /** Sentences after the lead. */
  detail: string[];
  cta: { label: string; path: string };
  /** The reassurance box, HTML. Omitted when there is nothing to reassure. */
  reassurance?: string;
};

/**
 * One entry per emailing type. Deliberately explicit rather than
 * generated from the type name: these are customer-facing sentences
 * about money and access, and they should be readable and editable as
 * sentences.
 *
 * Nothing here promises a capability the app does not have. Each of
 * these four is triggered by a real event that has already happened.
 */
const COPY: Record<EmailableNotificationType, Copy> = {
  subscription_past_due: {
    subject: "Your Moxie payment didn't go through",
    title: "We couldn't take your payment",
    detail: [
      "Nearly always this is an expired card or a bank hold rather than anything wrong with the account. Updating your payment method clears it straight away.",
    ],
    cta: { label: "Update your payment method", path: "/dashboard" },
    reassurance:
      "Nothing is paused yet, and nothing is ever deleted. Your vessels keep their MXE identity permanently, whatever happens to the subscription.",
  },
  vessel_lapsed: {
    subject: "Your Moxie subscription has ended",
    title: "Your subscription has ended",
    detail: [
      "Your badges carry on working — a scan still reaches each vessel's public profile. It is the owner-side features that are paused.",
    ],
    cta: { label: "Resubscribe", path: "/dashboard/upgrade" },
    reassurance:
      "There is nothing to set up again. Resubscribing restores every document, share and setting exactly as you left it.",
  },
  downgrade_grace_started: {
    subject: "Action needed on your Moxie account",
    title: "More vessels than your plan covers",
    detail: [
      `You have ${DORMANCY.DOWNGRADE_GRACE_DAYS} days to either upgrade or decommission the extra vessels. If nothing changes, the vessels beyond your plan's limit pause automatically, newest first.`,
    ],
    cta: { label: "Review your fleet", path: "/dashboard/manage-fleet" },
    reassurance:
      "A paused vessel is not a deleted one. It keeps its MXE ID and its record, and it comes back the moment there is room on your plan.",
  },
  vessel_locked: {
    subject: "A vessel on your Moxie account is locked",
    title: "A vessel is locked",
    detail: [
      "Its public profile and badge still work, so anyone scanning it still reaches the vessel. Document access, sharing and editing are what pause.",
    ],
    cta: { label: "Open your dashboard", path: "/dashboard" },
    reassurance:
      "The vessel's MXE identity is permanent and unaffected. Unlocking restores everything exactly as it was.",
  },
};

function origin(baseUrl?: string): string {
  return (baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://moxieyacht.com").replace(/\/$/, "");
}

export function notificationSubject(type: EmailableNotificationType): string {
  return COPY[type].subject;
}

export function renderNotificationEmailHtml(input: NotificationEmailInput): string {
  const copy = COPY[input.type];
  const url = `${origin(input.baseUrl)}${copy.cta.path}`;

  return renderEmailLayout({
    subject: copy.subject,
    // The MXE ID when the event is about one vessel, so an owner with
    // several knows which before opening. "Account" when it is about the
    // subscription rather than a boat.
    headerLabel: input.mxeId ?? "Account",
    title: copy.title,
    intro: [
      paragraph(escapeHtml(input.message)),
      ...copy.detail.map((d, i) => paragraph(escapeHtml(d), { last: i === copy.detail.length - 1 })),
    ],
    blocks: [
      button(url, copy.cta.label),
      ...(copy.reassurance ? [notice(escapeHtml(copy.reassurance))] : []),
    ],
    footerReason: "Sent by Moxie because of a change to your account.",
  });
}

export function renderNotificationEmailText(input: NotificationEmailInput): string {
  const copy = COPY[input.type];
  return renderPlainText({
    title: copy.title,
    paragraphs: [input.message, ...copy.detail],
    action: { label: copy.cta.label, url: `${origin(input.baseUrl)}${copy.cta.path}` },
    closing: copy.reassurance ? [copy.reassurance] : undefined,
    footerReason: "Sent by Moxie because of a change to your account.",
  });
}
