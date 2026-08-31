import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type BillingPayment = {
  vesselName: string;
  paymentType: string;
  status: string;
  paidAt: string | null;
};

export type BillingSummary = {
  subscriptionTier: "basic" | "full";
  subscriptionStatus: string | null;
  payments: BillingPayment[];
};

/**
 * Account-level, not per-vessel — payment history spans every vessel the
 * owner has, and tier/status live on `users`, not `vessels`. Shared by the
 * GET /api/users/:userId/billing route (build spec §14) and the owner
 * profile page, which pre-fetches this once per page load rather than
 * re-querying it when the fleet switcher changes vessels.
 */
export async function getOwnerBillingSummary(ownerId: string): Promise<BillingSummary | null> {
  const service = createSupabaseServiceClient();
  if (!service) return null;

  const { data: userRow } = await service
    .from("users")
    .select("subscription_tier, subscription_status")
    .eq("id", ownerId)
    .maybeSingle();
  const user = userRow as { subscription_tier: string | null; subscription_status: string | null } | null;

  const { data: vesselRows } = await service.from("vessels").select("id, vessel_name").eq("owner_id", ownerId);
  const vessels = (vesselRows ?? []) as { id: string; vessel_name: string }[];
  const vesselNameById = new Map(vessels.map((v) => [v.id, v.vessel_name]));
  const vesselIds = vessels.map((v) => v.id);

  let paymentRows: { vessel_id: string; payment_type: string; status: string; paid_at: string | null }[] = [];
  if (vesselIds.length > 0) {
    const { data } = await service
      .from("vessel_payments")
      .select("vessel_id, payment_type, status, paid_at")
      .in("vessel_id", vesselIds)
      .order("paid_at", { ascending: false });
    paymentRows = (data ?? []) as typeof paymentRows;
  }

  return {
    subscriptionTier: user?.subscription_tier === "full" ? "full" : "basic",
    subscriptionStatus: user?.subscription_status ?? null,
    payments: paymentRows.map((p) => ({
      vesselName: vesselNameById.get(p.vessel_id) ?? "Vessel",
      paymentType: p.payment_type,
      status: p.status,
      paidAt: p.paid_at,
    })),
  };
}
