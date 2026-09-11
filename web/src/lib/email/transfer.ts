/**
 * Emails to the BUYER of a vessel, who may not have a Moxie account.
 *
 * These go through notifyEmailAddress rather than notifyOwner — see that
 * function for why the two are kept apart, and for the note on emailing
 * an address supplied by a third party.
 *
 * The seller-facing side of a transfer is not here. Those recipients are
 * account holders, so their copy lives with every other account
 * notification in ./notification.ts.
 */
import { button, detailCard, fallbackUrl, notice, paragraph, renderEmailLayout, escapeHtml } from "./layout.ts";
import { renderPlainText } from "./plain-text.ts";
import { TRANSFER_EXPIRY_DAYS } from "../vessel-transfer.ts";

export type TransferEmailInput = {
  /** Accept link, absolute. Contains the single-use token. */
  acceptUrl: string;
  mxeId: string;
  vesselName: string | null;
  /** Who started it, for the recipient to recognise. */
  sellerName: string | null;
  sellerEmail: string | null;
  /** Formatted for display, e.g. "18 September 2026". */
  expiresOn: string;
};

const FOOTER_REASON =
  "Sent by Moxie because the current owner of this vessel started a transfer to your email address.";

function vesselLabel(input: TransferEmailInput): string {
  return input.vesselName?.trim() ? `${input.vesselName} (${input.mxeId})` : input.mxeId;
}

function initiator(input: TransferEmailInput): string {
  const name = input.sellerName?.trim();
  const email = input.sellerEmail?.trim();
  if (name && email) return `${name} (${email})`;
  return name || email || "the current owner";
}

export function transferInvitationSubject(input: TransferEmailInput): string {
  return `${initiator(input)} is transferring ${vesselLabel(input)} to you`;
}

/**
 * The reason this email exists at all: a transfer link that arrives from
 * Moxie carries credibility that the same link forwarded by the seller
 * does not. A stranger asking you to click a link about a boat is
 * indistinguishable from a phishing attempt; the same link, from the
 * registry that holds the vessel's identity, naming the vessel and who
 * started it, is verifiable.
 *
 * So the body names the vessel, names the initiator, and states the
 * deadline — the three things a recipient needs to decide whether this
 * is real.
 */
export function renderTransferInvitationHtml(input: TransferEmailInput): string {
  return renderEmailLayout({
    subject: transferInvitationSubject(input),
    headerLabel: input.mxeId,
    title: "A vessel is being transferred to you",
    intro: [
      paragraph(
        `${escapeHtml(initiator(input))} has started transferring <strong>${escapeHtml(vesselLabel(input))}</strong> to this email address on Moxie, the registry that holds the vessel's permanent identity.`,
      ),
      paragraph(
        `Accepting takes you through creating an account if you do not already have one. The vessel does not change hands until the seller completes the transfer after you accept.`,
        { last: true },
      ),
    ],
    blocks: [
      detailCard([
        { label: "Vessel", value: vesselLabel(input) },
        { label: "Transfer started by", value: initiator(input) },
        { label: "Link expires", value: input.expiresOn, emphasis: true },
      ]),
      button(input.acceptUrl, "Review this transfer"),
      fallbackUrl(input.acceptUrl),
      notice(
        `This link is single-use and expires after ${TRANSFER_EXPIRY_DAYS} days. If you weren't expecting this, you can ignore it &mdash; nothing happens unless you accept, and the vessel stays with its current owner.`,
      ),
    ],
    footerReason: FOOTER_REASON,
  });
}

export function renderTransferInvitationText(input: TransferEmailInput): string {
  return renderPlainText({
    title: "A vessel is being transferred to you",
    paragraphs: [
      `${initiator(input)} has started transferring ${vesselLabel(input)} to this email address on Moxie, the registry that holds the vessel's permanent identity.`,
      "Accepting takes you through creating an account if you do not already have one. The vessel does not change hands until the seller completes the transfer after you accept.",
    ],
    details: [
      { label: "Vessel", value: vesselLabel(input) },
      { label: "Transfer started by", value: initiator(input) },
      { label: "Link expires", value: input.expiresOn },
    ],
    action: { label: "Review this transfer", url: input.acceptUrl },
    closing: [
      `This link is single-use and expires after ${TRANSFER_EXPIRY_DAYS} days. If you weren't expecting this, you can ignore it - nothing happens unless you accept, and the vessel stays with its current owner.`,
    ],
    footerReason: FOOTER_REASON,
  });
}

/**
 * PRE-EXPIRY REMINDER — BUILT, WIRED TO NOTHING.
 *
 * Nothing fires on a date in this application; that is stage 4's
 * scheduler. This exists so the copy is settled and the template comes
 * off the same layout as everything else rather than being retrofitted
 * later, and for no other reason.
 *
 * It is not referenced in any application copy, and must not be. The
 * standing constraint is that nothing may promise a notification the app
 * cannot deliver, and until a scheduler exists this one cannot be
 * delivered at all.
 */
export function transferExpiryReminderSubject(input: TransferEmailInput & { daysLeft: number }): string {
  const when = input.daysLeft <= 1 ? "tomorrow" : `in ${input.daysLeft} days`;
  return `Your transfer link for ${vesselLabel(input)} expires ${when}`;
}

export function renderTransferExpiryReminderHtml(input: TransferEmailInput & { daysLeft: number }): string {
  const when = input.daysLeft <= 1 ? "tomorrow" : `in ${input.daysLeft} days`;
  return renderEmailLayout({
    subject: transferExpiryReminderSubject(input),
    headerLabel: input.mxeId,
    title: `Your transfer link expires ${when}`,
    intro: [
      paragraph(
        `${escapeHtml(initiator(input))} started transferring <strong>${escapeHtml(vesselLabel(input))}</strong> to you, and the link has not been used yet.`,
      ),
      paragraph(
        "If the link expires, the transfer simply stops and the vessel stays with its current owner. The seller can start a new one.",
        { last: true },
      ),
    ],
    blocks: [
      detailCard([
        { label: "Vessel", value: vesselLabel(input) },
        { label: "Transfer started by", value: initiator(input) },
        { label: "Link expires", value: input.expiresOn, emphasis: true },
      ]),
      button(input.acceptUrl, "Review this transfer"),
      fallbackUrl(input.acceptUrl),
    ],
    footerReason: FOOTER_REASON,
  });
}

export function renderTransferExpiryReminderText(input: TransferEmailInput & { daysLeft: number }): string {
  const when = input.daysLeft <= 1 ? "tomorrow" : `in ${input.daysLeft} days`;
  return renderPlainText({
    title: `Your transfer link expires ${when}`,
    paragraphs: [
      `${initiator(input)} started transferring ${vesselLabel(input)} to you, and the link has not been used yet.`,
      "If the link expires, the transfer simply stops and the vessel stays with its current owner. The seller can start a new one.",
    ],
    details: [
      { label: "Vessel", value: vesselLabel(input) },
      { label: "Link expires", value: input.expiresOn },
    ],
    action: { label: "Review this transfer", url: input.acceptUrl },
    footerReason: FOOTER_REASON,
  });
}
