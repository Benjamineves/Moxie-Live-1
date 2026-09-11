import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";
import { generateShareToken } from "./share-token.ts";
import { TRANSFER_EXPIRY_DAYS } from "./vessel-transfer.ts";
import { notifyEmailAddress } from "./notify-address.ts";
import {
  renderTransferInvitationHtml,
  renderTransferInvitationText,
  transferInvitationSubject,
} from "./email/transfer.ts";

/**
 * Creates the transfer row and emails the buyer.
 *
 * This is everything initiateOwnershipTransfer does BELOW its
 * authorization gate. The server action keeps the parts that decide who
 * is allowed to do this — session, ownership, vessel state, no transfer
 * already in flight — and hands off here for the part that actually
 * happens.
 *
 * Split out so it can be exercised without a signed-in browser session.
 * Replicating it in a test script instead would mean testing the replica
 * rather than the code that runs in production, which is the trap that
 * makes a green test worthless.
 *
 * It does NOT authorize anything. Every caller must have established
 * that the actor may transfer this vessel before calling.
 */
export type TransferVessel = {
  id: string;
  mxe_id: string;
  vessel_name: string | null;
  owner_id: string;
  owner_email: string | null;
  owner_name: string | null;
};

export async function createTransferAndNotifyBuyer(input: {
  service: SupabaseClient<PermissiveDatabase>;
  vessel: TransferVessel;
  /** Already normalized and validated by the caller. */
  buyerEmail: string;
  baseUrl?: string;
}): Promise<{
  token?: string;
  transferId?: string;
  error?: string;
  /** Whether the buyer's invitation actually went out. False is not a failure of the transfer. */
  emailed?: boolean;
  emailFailureReason?: string;
}> {
  const { service, vessel, buyerEmail } = input;

  const { token, tokenHash } = generateShareToken();
  const expiresAt = new Date(Date.now() + TRANSFER_EXPIRY_DAYS * 24 * 60 * 60 * 1000);

  const { data: created, error } = await service
    .from("ownership_transfers")
    .insert({
      vessel_id: vessel.id,
      mxe_id: vessel.mxe_id,
      seller_id: vessel.owner_id,
      initiated_by: vessel.owner_id,
      initiated_via: "owner",
      buyer_email: buyerEmail,
      token_hash: tokenHash,
      expires_at: expiresAt.toISOString(),
    })
    .select("id")
    .maybeSingle();
  if (error) return { error: error.message };

  const transferId = (created as { id: string } | null)?.id;

  // Email the buyer the link ourselves rather than leaving the seller to
  // forward it. A link that arrives from Moxie, naming the vessel and
  // who started the transfer, is verifiable; the same link pasted into a
  // message from a stranger is indistinguishable from phishing. That
  // credibility is the point.
  //
  // Best effort, and deliberately after the insert: the transfer exists
  // whether or not the email lands, the seller still has the link on
  // screen, and a provider outage must not fail an action the seller has
  // already completed.
  //
  // But best-effort is not the same as unknown. The result is returned
  // rather than discarded, because the panel now tells the seller "we've
  // emailed the buyer" — and it can only say that honestly if it knows.
  // When the send fails the seller is the fallback, and they can only
  // act as one if they are told.
  const origin = (input.baseUrl ?? process.env.NEXT_PUBLIC_BASE_URL ?? "https://moxieyacht.com").replace(/\/$/, "");
  const emailInput = {
    acceptUrl: `${origin}/transfer/accept?token=${encodeURIComponent(token)}`,
    mxeId: vessel.mxe_id,
    vesselName: vessel.vessel_name,
    sellerName: vessel.owner_name,
    sellerEmail: vessel.owner_email,
    expiresOn: expiresAt.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }),
  };
  const invitation = await notifyEmailAddress({
    to: buyerEmail,
    subject: transferInvitationSubject(emailInput),
    html: renderTransferInvitationHtml(emailInput),
    text: renderTransferInvitationText(emailInput),
    context: `transfer invitation for ${vessel.mxe_id} (transfer ${transferId ?? "unknown"})`,
  });

  return { token, transferId, emailed: invitation.sent, emailFailureReason: invitation.reason };
}
