import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * MXE IDs come from the mxe_id_seq Postgres sequence, via the
 * next_mxe_id() RPC (see migration 20260904_mxe_id_sequence.sql).
 * Sequence values are never reused, including after a vessel is deleted
 * — which matters because an MXE ID is permanent identity printed on a
 * physical badge and encoded in the public scan URL.
 *
 * There is deliberately NO fallback here. The previous version dropped
 * back to deriving an ID from MAX(vessels.mxe_id) when the RPC failed,
 * which could hand out an ID that a deleted vessel had already used —
 * the exact collision the sequence exists to prevent. Failing the
 * registration is strictly better than minting a duplicate identity, so
 * an RPC failure now throws.
 */
export async function generateNextMxeId(): Promise<string> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    throw new Error("Missing Supabase service role configuration.");
  }

  const { data, error } = await supabase.rpc("next_mxe_id");
  if (error) {
    throw new Error(`Could not allocate an MXE ID: ${error.message}`);
  }
  if (typeof data !== "string" || !/^MXE-\d{5}$/i.test(data)) {
    throw new Error("Could not allocate an MXE ID: unexpected value from next_mxe_id().");
  }

  return data.toUpperCase();
}
