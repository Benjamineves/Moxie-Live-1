import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function generateNextMxeId(): Promise<string> {
  const supabase = createSupabaseServiceClient();
  if (!supabase) {
    throw new Error("Missing Supabase service role configuration.");
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc("next_mxe_id");
  if (!rpcError && typeof rpcData === "string" && /^MXE-\d{5}$/i.test(rpcData)) {
    return rpcData.toUpperCase();
  }

  const { data, error } = await supabase
    .from("vessels")
    .select("mxe_id")
    .ilike("mxe_id", "MXE-%")
    .order("mxe_id", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  const last = data?.mxe_id;
  const numeric = last?.match(/^MXE-(\d{5})$/i)?.[1];
  const nextNum = numeric ? Number.parseInt(numeric, 10) + 1 : 1;
  return `MXE-${String(nextNum).padStart(5, "0")}`;
}
