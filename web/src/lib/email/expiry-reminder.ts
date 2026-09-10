/**
 * Document expiry reminder.
 *
 * BUILT, WIRED TO NOTHING. There is no scheduler, no sender, and no
 * opt-out. It exists now so both templates come off one layout rather
 * than the second being retrofitted later, and so the copy is settled
 * before anything can send it.
 *
 * THE COPY CONSTRAINT THIS FILE SITS UNDER
 *
 * Nothing in the application may promise reminders, notifications or
 * alerts until sending actually exists. This template living in the
 * repository is NOT permission to reference it in app copy — an owner
 * who reads "we'll remind you" and receives nothing has been lied to,
 * and the fix for that is sending, not wording.
 *
 * ONE DELIBERATE DEPARTURE FROM THE MOCKUP
 *
 * The mockup's footer reads "Manage reminders in your vessel settings."
 * That control does not exist, so the sentence is omitted rather than
 * reworded into a vaguer version of the same promise. The rest of the
 * footer is unchanged. When an opt-out is built, this is where the line
 * goes back.
 */
import { button, detailCard, paragraph, renderEmailLayout, escapeHtml, EMAIL_COLORS } from "./layout.ts";
import { renderPlainText } from "./plain-text.ts";
import type { ExpiryDocType } from "../document-expiry.ts";

/**
 * Reuses the app's own document-type union rather than declaring a
 * parallel one — a reminder that can be sent for a document type the app
 * does not track, or that misses one it does, is a drift bug waiting to
 * happen.
 */
export const EXPIRY_DOC_LABELS: Record<ExpiryDocType, string> = {
  registration: "Registration",
  insurance: "Insurance",
  fishing_license: "Fishing licence",
};

export type ExpiryReminderInput = {
  vesselName: string;
  mxeId: string;
  docType: ExpiryDocType;
  /** Already formatted for display, e.g. "Oct 10, 2026". */
  expiryDate: string;
  /** Whole days until expiry, for the heading. */
  daysRemaining: number;
  /** Absolute origin — emails cannot use relative links. */
  baseUrl?: string;
};

const FOOTER_REASON = "You're receiving this because you added an expiry date for this document.";

function documentsUrl(mxeId: string, baseUrl?: string): string {
  const origin = (baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://moxieyacht.com").replace(/\/$/, "");
  return `${origin}/dashboard/${encodeURIComponent(mxeId)}/documents`;
}

function heading(input: ExpiryReminderInput): string {
  const label = EXPIRY_DOC_LABELS[input.docType];
  if (input.daysRemaining < 0) return `${label} has expired`;
  if (input.daysRemaining === 0) return `${label} expires today`;
  if (input.daysRemaining === 1) return `${label} expires tomorrow`;
  return `${label} expires in ${input.daysRemaining} days`;
}

export function expiryReminderSubject(input: ExpiryReminderInput): string {
  return `${heading(input)} — ${input.vesselName}`;
}

export function renderExpiryReminderHtml(input: ExpiryReminderInput): string {
  const label = EXPIRY_DOC_LABELS[input.docType];
  const url = documentsUrl(input.mxeId, input.baseUrl);

  return renderEmailLayout({
    subject: expiryReminderSubject(input),
    // The MXE ID, not "Account" — an owner with several boats needs to
    // know which one this is about before opening it.
    headerLabel: input.mxeId,
    title: heading(input),
    intro: [
      paragraph(
        `The ${escapeHtml(label.toLowerCase())} document on file for <strong style="color:${EMAIL_COLORS.navy};">${escapeHtml(
          input.vesselName,
        )}</strong> expires soon. Once you've renewed, upload the new document so the vessel record stays current.`,
        { last: true },
      ),
    ],
    blocks: [
      detailCard([
        { label: "Vessel", value: input.vesselName },
        { label: "Document", value: label },
        { label: "Expires", value: input.expiryDate, emphasis: true },
      ]),
      button(url, "Update this document"),
    ],
    footerReason: FOOTER_REASON,
  });
}

export function renderExpiryReminderText(input: ExpiryReminderInput): string {
  const label = EXPIRY_DOC_LABELS[input.docType];
  return renderPlainText({
    title: heading(input),
    paragraphs: [
      `The ${label.toLowerCase()} document on file for ${input.vesselName} expires soon. Once you've renewed, upload the new document so the vessel record stays current.`,
    ],
    details: [
      { label: "Vessel", value: input.vesselName },
      { label: "Document", value: label },
      { label: "Expires", value: input.expiryDate },
    ],
    action: { label: "Update this document", url: documentsUrl(input.mxeId, input.baseUrl) },
    footerReason: FOOTER_REASON,
  });
}
