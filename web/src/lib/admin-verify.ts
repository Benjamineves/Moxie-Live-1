import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export type AdminUser = { id: string; email: string };

/**
 * The ADMIN_EMAILS allowlist alone, with no role check — same
 * comma-separated, case-insensitive parsing requireAdmin() below uses.
 * Deliberately looser than requireAdmin(): this is for low-stakes,
 * internal-only exemptions (e.g. the vessel-cap bypass in
 * dashboard/new/actions.ts and the SQL functions' is_admin_email(),
 * which mirrors this same env var by hand since Postgres can't read
 * process.env), not for gating anything that exposes customer data —
 * that still needs the full, redundant requireAdmin() check.
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowlist = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return allowlist.includes(email.trim().toLowerCase());
}

/**
 * Resolves the signed-in session to an admin identity, or null. Two
 * independent checks, both required — fails closed if either is missing:
 *
 *  1. The public.users row matched by session email has role='admin'.
 *     Email-based, not auth.uid()-based — matches how every other identity
 *     check in this app resolves a session to a users row, because the
 *     seeded admin account's users.id doesn't match its real Supabase Auth
 *     session id. See build spec §9-C-13 for why this lookup mechanism is
 *     itself a known, documented weak point.
 *  2. The session email is also listed in the ADMIN_EMAILS env var
 *     (comma-separated, case-insensitive). Deliberately redundant with #1:
 *     for a page that exposes every customer's contact info at once, the
 *     email-matching mechanism alone isn't enough — both must agree.
 */
export async function requireAdmin(): Promise<AdminUser | null> {
  const authClient = await createSupabaseServerClient();
  if (!authClient) return null;

  const {
    data: { user },
  } = await authClient.auth.getUser();
  const email = user?.email?.trim().toLowerCase();
  if (!email) return null;

  if (!isAdminEmail(email)) return null;

  const service = createSupabaseServiceClient();
  if (!service) return null;

  const { data: userRow } = await service.from("users").select("id, email, role").eq("email", email).maybeSingle();
  const row = userRow as { id: string; email: string; role: string } | null;
  if (!row || row.role !== "admin") return null;

  return { id: row.id, email: row.email };
}
