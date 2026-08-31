import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub";

let cached: SupabaseClient<PermissiveDatabase> | null | undefined;

/** Server/route use only; anon key + RLS policies expected on Supabase. */
export function getPublicSupabase(): SupabaseClient<PermissiveDatabase> | null {
  if (cached !== undefined) return cached;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) {
    cached = null;
    return null;
  }
  cached = createClient<PermissiveDatabase>(url, key);
  return cached;
}
