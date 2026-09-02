import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import { TransferPaymentForm } from "./TransferPaymentForm";

type Props = {
  params: Promise<{ transferId: string }>;
};

export default async function TransferPaymentPage({ params }: Props) {
  const { transferId } = await params;

  const authClient = await createSupabaseServerClient();
  if (!authClient) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/transfer/${transferId}/payment`)}`);
  }

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/transfer/${transferId}/payment`)}`);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, seller_id, buyer_email, status")
    .eq("id", transferId)
    .maybeSingle();
  const transfer = transferRow as
    | { id: string; mxe_id: string; seller_id: string; buyer_email: string; status: string }
    | null;

  if (!transfer || !ownerIds.includes(transfer.seller_id)) {
    redirect("/dashboard");
  }

  if (transfer.status === "completed") {
    redirect(`/${encodeURIComponent(transfer.mxe_id)}?role=owner`);
  }
  if (transfer.status !== "awaiting_payment") {
    // pending / expired / canceled / reversed — nothing to pay for.
    redirect("/dashboard");
  }

  // Transfer fee is $49/Basic, $25/Full — the SELLER's tier, same as
  // createTransferFeeIntent's own price selection (payment/actions.ts).
  const { data: sellerRow } = await service
    .from("users")
    .select("subscription_tier")
    .eq("id", transfer.seller_id)
    .maybeSingle();
  const sellerTier: "basic" | "full" = (sellerRow as { subscription_tier: string | null } | null)?.subscription_tier === "full" ? "full" : "basic";

  const publishableKey = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim();
  if (!publishableKey) {
    return (
      <div className="min-h-screen bg-[var(--cream)] px-6 py-16">
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Payments not configured
        </h1>
        <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          Add <code className="rounded bg-[var(--cream2)] px-1 text-xs">NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY</code> to
          the server environment.
        </p>
      </div>
    );
  }

  return (
    <TransferPaymentForm
      transferId={transfer.id}
      mxeId={transfer.mxe_id}
      buyerEmail={transfer.buyer_email}
      sellerTier={sellerTier}
      publishableKey={publishableKey}
    />
  );
}
