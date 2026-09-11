import { sendEmail } from "./email/send.ts";

/**
 * SIBLING TO notifyOwner, for a recipient identified only by an email
 * address.
 *
 * Deliberately a separate function rather than a branch inside
 * notifyOwner. That function's value is that grepping `notifyOwner(`
 * finds every notification an account holder receives; folding "email a
 * stranger by address" into it would destroy that property for a small
 * saving in lines. Grep `notifyEmailAddress(` to find every message sent
 * to someone who is not (yet) a user.
 *
 * They share the Resend client and the email layout. They share nothing
 * else, and should not:
 *
 *  - There is no in-app row to write. The recipient has no account, so
 *    there is nowhere to put one and nobody to read it.
 *  - There is no dedupe window keyed on an owner id, for the same
 *    reason. Callers pass their own key if they need one.
 *
 * WHO WE ARE EMAILING, AND WHY IT IS ACCEPTABLE
 *
 * The address comes from a THIRD PARTY — a seller typing in their
 * buyer's email. The recipient never signed up, never gave us their
 * address, and may have no idea Moxie exists. That is a real
 * responsibility, and what makes it acceptable is narrow:
 *
 *  - It is transactional. Someone is transferring a boat to them and
 *    they need the link to accept it.
 *  - It is one-shot. One message per transfer, triggered by a human
 *    action, about a thing that concerns the recipient directly.
 *
 * Anything RECURRING to that address would not be acceptable, and
 * nothing here should grow into it. A marketing send, a digest, or a
 * nudge series to an address obtained this way is a different thing
 * wearing the same clothes.
 */
export type AddressEmailResult = { sent: boolean; id?: string | null; reason?: string };

export async function notifyEmailAddress(input: {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** For the log line, so a failure can be traced to its transfer. */
  context: string;
}): Promise<AddressEmailResult> {
  const to = input.to.trim().toLowerCase();
  if (!to || !to.includes("@")) {
    console.error(`[notify-address] Refusing to send ${input.context}: "${input.to}" is not an email address.`);
    return { sent: false, reason: "invalid address" };
  }

  const result = await sendEmail({ to, subject: input.subject, html: input.html, text: input.text });

  if (result.sent) {
    console.log(`[notify-address] Sent ${input.context} to ${to} (resend id=${result.id ?? "unknown"}).`);
    return { sent: true, id: result.id };
  }
  if (result.reason === "disabled") {
    console.log(`[notify-address] Email disabled (no RESEND_API_KEY); ${input.context} not sent to ${to}.`);
    return { sent: false, reason: "disabled" };
  }
  console.error(`[notify-address] Resend failed for ${input.context} to ${to}: ${result.detail}`);
  return { sent: false, reason: result.detail };
}
