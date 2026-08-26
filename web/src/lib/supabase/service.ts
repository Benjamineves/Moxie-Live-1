import { createClient } from "@supabase/supabase-js";

let cachedServiceClient:
  | ReturnType<typeof createClient>
  | null
  | undefined;

export function createSupabaseServiceClient() {
  if (cachedServiceClient !== undefined) return cachedServiceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    cachedServiceClient = null;
    return null;
  }

  cachedServiceClient = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedServiceClient;
}
