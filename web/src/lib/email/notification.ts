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
  /**
   * Path is resolvable rather than fixed so the buyer's completion email
   * can link at the vessel they have just been given rather than a
   * dashboard they then have to search.
   */
  cta: { label: string; path: string | ((mxeId: string | null) => string) };
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
  transfer_accepted: {
    subject: "Your buyer accepted the transfer",
    title: "Your buyer accepted",
    detail: [
      "Ownership has not moved yet. The transfer fee is the last step, and the vessel stays yours until it is paid.",
    ],
    cta: { label: "Complete the transfer", path: "/dashboard" },
    reassurance:
      "Nothing changes on the vessel until you complete payment. If you have changed your mind, you can still cancel the transfer.",
  },
  transfer_declined_or_expired: {
    subject: "Your vessel transfer didn't go through",
    title: "The transfer didn't go through",
    detail: [
      "The vessel is still yours and nothing about it has changed. If the sale is still on, start a new transfer and the buyer will get a fresh link.",
    ],
    cta: { label: "Start a new transfer", path: "/dashboard" },
    reassurance:
      "No fee was charged. A transfer only costs anything once the buyer has accepted and you complete it.",
  },
  transfer_completed_seller: {
    subject: "Transfer complete — the vessel is no longer yours",
    title: "The transfer is complete",
    detail: [
      "The vessel now belongs to the buyer, and your shares of it have been revoked. The transfer fee has been charged to your card.",
      "A read-only copy of the vessel as it was on the day you transferred it stays in your dashboard.",
    ],
    cta: { label: "View your record of it", path: "/dashboard" },
  },
  transfer_completed_buyer: {
    subject: "The vessel is yours",
    title: "The vessel is yours",
    detail: [
      "It keeps the MXE ID it already had, so the badge on the hull carries on working and now resolves to you.",
      "Its documents did not come with it — registration and insurance belong to the previous owner. Upload yours to bring the record up to date.",
    ],
    cta: {
      label: "Open your vessel",
      path: (mxeId) => (mxeId ? `/dashboard/${encodeURIComponent(mxeId)}` : "/dashboard"),
    },
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

function ctaPath(copy: Copy, mxeId: string | null): string {
  return typeof copy.cta.path === "function" ? copy.cta.path(mxeId) : copy.cta.path;
}

function origin(baseUrl?: string): string {
  return (baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://moxieyacht.com").replace(/\/$/, "");
}

export function notificationSubject(type: EmailableNotificationType): string {
  return COPY[type].subject;
}

export function renderNotificationEmailHtml(input: NotificationEmailInput): string {
  const copy = COPY[input.type];
  const url = `${origin(input.baseUrl)}${ctaPath(copy, input.mxeId ?? null)}`;

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
    action: { label: copy.cta.label, url: `${origin(input.baseUrl)}${ctaPath(copy, input.mxeId ?? null)}` },
    closing: copy.reassurance ? [copy.reassurance] : undefined,
    footerReason: "Sent by Moxie because of a change to your account.",
  });
}
