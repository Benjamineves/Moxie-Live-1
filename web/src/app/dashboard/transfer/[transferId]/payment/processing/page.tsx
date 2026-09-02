import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import { ActivationPoller } from "@/components/ActivationPoller";

type Props = {
  params: Promise<{ transferId: string }>;
};

/**
 * Landing spot after Stripe confirms the transfer-fee payment
 * client-side. The actual ownership move only happens once the webhook
 * (payment_intent.succeeded, payment_type='transfer_fee') calls
 * complete_ownership_transfer — this page waits it out, same pattern as
 * the badge-fee and Full-upgrade processing pages.
 */
export default async function TransferPaymentProcessingPage({ params }: Props) {
  const { transferId } = await params;

  const authClient = await createSupabaseServerClient();
  if (!authClient) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/transfer/${transferId}/payment/processing`)}`);
  }

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/transfer/${transferId}/payment/processing`)}`);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, seller_id, status")
    .eq("id", transferId)
    .maybeSingle();
  const transfer = transferRow as { id: string; mxe_id: string; seller_id: string; status: string } | null;

  if (!transfer || !ownerIds.includes(transfer.seller_id)) {
    redirect("/dashboard");
  }

  if (transfer.status === "completed") {
    redirect("/dashboard?transferred=1");
  }

  return <ActivationPoller mxeId={transfer.mxe_id} mode="transfer" />;
}
