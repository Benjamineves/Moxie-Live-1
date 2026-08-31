import type { SupabaseClient } from "@supabase/supabase-js";
import { createBrowserClient } from "@supabase/ssr";
import type { PermissiveDatabase } from "./schema-stub";

export function createSupabaseBrowserClient(): SupabaseClient<PermissiveDatabase> | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;
  return createBrowserClient<PermissiveDatabase>(url, key);
}
