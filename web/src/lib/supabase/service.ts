import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./schema-stub";

let cachedServiceClient: SupabaseClient<PermissiveDatabase> | null | undefined;

/**
 * Thrown when SUPABASE_SERVICE_ROLE_KEY or NEXT_PUBLIC_SUPABASE_URL is
 * missing. A distinct type so a caller that must not 500 — the Stripe
 * webhook, the health probe — can still tell this apart from a query that
 * failed.
 */
export class ServiceRoleNotConfiguredError extends Error {
  constructor(where: string) {
    super(`Supabase service role is not configured (${where}). Set SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_URL.`);
    this.name = "ServiceRoleNotConfiguredError";
  }
}

/**
 * THE ONLY WAY A PAGE, ACTION OR LIBRARY SHOULD GET THE SERVICE CLIENT.
 *
 * A missing service role is a deploy that is broken, not a fact about the
 * visitor. Handled locally it looked like one: 22 pages redirected, so a
 * config failure read as "you are not an admin" or "you have been signed
 * out"; four more silently skipped their work and rendered a normal page,
 * one of them showing an owner an empty fleet; 34 actions returned a tidy
 * inline error. Vercel reported success and nothing alerted.
 *
 * This throws instead, which is a 500 from any page or server component,
 * and it is a shared helper rather than 60 local decisions so that the
 * next page cannot quietly pick a different one — see
 * supabase/service.guard.test.mts, which fails if anything outside a short
 * allow-list calls createSupabaseServiceClient directly.
 *
 * `createSupabaseServiceClient` stays exported for that allow-list: callers
 * that already return their own 5xx (the cron route, the Stripe webhook,
 * the health probe) or that must answer without throwing.
 */
export function requireSupabaseServiceClient(where: string): SupabaseClient<PermissiveDatabase> {
  const client = createSupabaseServiceClient();
  if (!client) {
    console.error(`[config] Supabase service role missing at ${where}.`);
    throw new ServiceRoleNotConfiguredError(where);
  }
  return client;
}

export function createSupabaseServiceClient() {
  if (cachedServiceClient !== undefined) return cachedServiceClient;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key) {
    cachedServiceClient = null;
    return null;
  }

  cachedServiceClient = createClient<PermissiveDatabase>(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return cachedServiceClient;
}
