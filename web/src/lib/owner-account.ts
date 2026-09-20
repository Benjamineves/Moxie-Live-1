import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";

/**
 * The account row for a signed-in user, created if this is the first thing
 * they have done that needs one.
 *
 * ROWS ARE CREATED ON FIRST MEANINGFUL ACTION, NOT AT SIGNUP. Signing up
 * creates an Auth account and nothing else; `public.users` gains a row when
 * someone registers a vessel, accepts a transfer, is attached to a marina —
 * or, through this helper, buys a plan before owning a boat. See the
 * roadmap for why signup is the wrong moment: `users.email` is UNIQUE and
 * at least one account's row id deliberately differs from its Auth id, so
 * an insert keyed on the Auth id at signup collides.
 *
 * Which is also why the lookup order here is EMAIL FIRST, id second. The
 * email is the identity the rest of the app matches on (owner-verify.ts);
 * an existing row always wins, and only a genuinely new email inserts.
 */

type ServiceClient = SupabaseClient<PermissiveDatabase>;

export type OwnerAccount = {
  id: string;
  email: string;
  stripe_customer_id: string | null;
  subscription_status: string | null;
  stripe_subscription_id: string | null;
};

const COLUMNS = "id, email, stripe_customer_id, subscription_status, stripe_subscription_id";

/** Same derivation the vessel-intake and transfer-accept paths use. */
export function displayNameFromEmail(email: string): string {
  const local = email.split("@")[0]?.replace(/[._-]+/g, " ").trim() ?? "";
  const name = local
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return name || "Vessel Owner";
}

export async function findOwnerAccount(
  service: ServiceClient,
  user: { id: string; email?: string | null },
): Promise<OwnerAccount | null> {
  const email = user.email?.trim().toLowerCase();
  if (email) {
    const { data, error } = await service.from("users").select(COLUMNS).eq("email", email).maybeSingle();
    if (error) throw new Error(`Failed to load account: ${error.message}`);
    if (data) return data as OwnerAccount;
  }
  const { data, error } = await service.from("users").select(COLUMNS).eq("id", user.id).maybeSingle();
  if (error) throw new Error(`Failed to load account: ${error.message}`);
  return (data as OwnerAccount | null) ?? null;
}

/**
 * Find or create. Returns null only when the session carries no email,
 * which nothing in this app produces — every provider gives one.
 */
export async function ensureOwnerAccount(
  service: ServiceClient,
  user: { id: string; email?: string | null },
): Promise<OwnerAccount | null> {
  const existing = await findOwnerAccount(service, user);
  if (existing) return existing;

  const email = user.email?.trim().toLowerCase();
  if (!email) return null;

  const { data, error } = await service
    .from("users")
    .insert({ id: user.id, email, full_name: displayNameFromEmail(email), role: "owner" })
    .select(COLUMNS)
    .single();
  if (error) {
    // Someone else created it between the read and the write (two tabs, a
    // double click): take theirs rather than reporting a failure.
    const again = await findOwnerAccount(service, user);
    if (again) return again;
    throw new Error(`Failed to create account: ${error.message}`);
  }
  return data as OwnerAccount;
}
