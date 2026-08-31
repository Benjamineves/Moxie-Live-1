import { createClient } from "@supabase/supabase-js";
import { getPublicSupabase } from "@/lib/supabase-public";
import type { PermissiveDatabase } from "@/lib/supabase/schema-stub";

/** Resolve vessel owner email for permission checks. Prefer service role when set (server-only). */
export async function getOwnerEmailByUserId(ownerId: string): Promise<string | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

  if (url && serviceKey) {
    const admin = createClient<PermissiveDatabase>(url, serviceKey, { auth: { persistSession: false } });
    const { data, error } = await admin.from("users").select("email").eq("id", ownerId).maybeSingle();
    if (!error && data?.email) return data.email;
  }

  const anon = getPublicSupabase();
  if (!anon) return null;
  const { data, error } = await anon.from("users").select("email").eq("id", ownerId).maybeSingle();
  if (error || !data?.email) return null;
  return data.email;
}

export function emailsMatch(a: string | undefined | null, b: string | undefined | null) {
  if (!a || !b) return false;
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}
