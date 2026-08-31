"use server";

import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

const STATUSES = ["not_ordered", "ordered", "printed", "shipped"] as const;
export type StickerOrderStatus = (typeof STATUSES)[number];

export async function updateStickerOrderStatus(
  mxeId: string,
  status: StickerOrderStatus,
): Promise<{ error?: string }> {
  // Re-checks admin independently — never trust that only the gated page
  // can reach this action, same defense-in-depth principle used for
  // ownership checks elsewhere (e.g. payment/actions.ts).
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  if (!STATUSES.includes(status)) return { error: "Invalid status." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { error } = await service
    .from("vessels")
    .update({ sticker_order_status: status })
    .eq("mxe_id", mxeId.toUpperCase());

  if (error) return { error: error.message };
  return {};
}
