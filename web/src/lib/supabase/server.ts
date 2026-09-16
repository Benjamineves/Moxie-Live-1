import type { SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { PermissiveDatabase } from "./schema-stub";

/**
 * Thrown when NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_URL is
 * missing. The anon-client twin of ServiceRoleNotConfiguredError: same
 * silent-failure shape, one env var over.
 */
export class AnonKeyNotConfiguredError extends Error {
  constructor(where: string) {
    super(`Supabase anon client is not configured (${where}). Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.`);
    this.name = "AnonKeyNotConfiguredError";
  }
}

/**
 * THE ONLY WAY TO GET THE ANON CLIENT, for the same reason as
 * requireSupabaseServiceClient: a null here was being folded into "not
 * signed in", so a missing anon key logged everyone out rather than
 * reporting a broken deploy. Held to it by supabase/service.guard.test.mts.
 */
export async function requireSupabaseServerClient(where: string): Promise<SupabaseClient<PermissiveDatabase>> {
  const client = await createSupabaseServerClient();
  if (!client) {
    console.error(`[config] Supabase anon key missing at ${where}.`);
    throw new AnonKeyNotConfiguredError(where);
  }
  return client;
}

export async function createSupabaseServerClient(): Promise<SupabaseClient<PermissiveDatabase> | null> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  if (!url || !key) return null;

  const cookieStore = await cookies();

  return createServerClient<PermissiveDatabase>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          /* read-only cookie scope */
        }
      },
    },
  });
}
