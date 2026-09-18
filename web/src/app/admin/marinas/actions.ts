"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { formatJoinCode, generateMarinaJoinCode } from "@/lib/marina-access";

/**
 * Admin writes for marina accounts. docs/moxie_digital_marina_access_spec.md §5.1–5.2.
 *
 * Every action re-checks requireAdmin(): a server action receives whatever
 * a client sends, and the page hiding its forms is not authorization.
 */

type Result = { error?: string };

async function adminService() {
  const admin = await requireAdmin();
  if (!admin) return null;
  return requireSupabaseServiceClient("app/admin/marinas/actions");
}

/**
 * Create a marina and issue its code in one pass — what gets done on a
 * phone in the marina's office. Refuses a second marina with the same
 * name, since a duplicate made in a hurry would split one marina's
 * tenants across two codes.
 */
export async function createMarinaWithCode(input: {
  name: string;
  city: string;
  state: string;
}): Promise<Result & { code?: string; name?: string }> {
  const service = await adminService();
  if (!service) return { error: "Admins only." };

  const name = input.name.trim().replace(/\s+/g, " ");
  const city = input.city.trim() || null;
  const state = input.state.trim().toUpperCase() || null;
  if (!name) return { error: "Enter the marina's name." };
  if (state && !/^[A-Z]{2}$/.test(state)) return { error: "State is two letters, like CA." };

  const { data: existing, error: lookupError } = await service.from("marinas").select("id, name").ilike("name", name.replace(/[\\%_]/g, "\\$&"));
  if (lookupError) return { error: lookupError.message };
  if ((existing ?? []).length > 0) {
    return { error: `A marina called "${(existing as { name: string }[])[0].name}" already exists — it's in the list below.` };
  }

  const { data: created, error: insertError } = await service
    .from("marinas")
    .insert({ name, city, state })
    .select("id")
    .single();
  if (insertError || !created) return { error: insertError?.message ?? "Couldn't create the marina." };

  try {
    const code = await generateMarinaJoinCode(service, (created as { id: string }).id, false);
    revalidatePath("/admin/marinas");
    return { code: formatJoinCode(code), name };
  } catch (e) {
    revalidatePath("/admin/marinas");
    return { error: `${name} was created, but its code wasn't issued (${(e as Error).message}). Use "Issue code" on it below.` };
  }
}

/**
 * replace=false issues a code only if there is none. replace=true draws a
 * new one: the old poster stops working, existing grants are unaffected.
 */
export async function issueMarinaCode(marinaId: string, replace: boolean): Promise<Result & { code?: string }> {
  const service = await adminService();
  if (!service) return { error: "Admins only." };
  try {
    const code = await generateMarinaJoinCode(service, marinaId, replace);
    revalidatePath("/admin/marinas");
    return { code: formatJoinCode(code) };
  } catch (e) {
    return { error: (e as Error).message };
  }
}

/**
 * Staff are ordinary accounts with users.marina_id set (spec §9.2) — the
 * person signs up themselves, then is attached here. No Supabase Auth
 * writes: accounts are created by the people who use them.
 */
export async function attachMarinaStaff(marinaId: string, email: string): Promise<Result> {
  const service = await adminService();
  if (!service) return { error: "Admins only." };
  const normalized = email.trim().toLowerCase();
  if (!normalized) return { error: "Enter their email." };

  const { data: userRow, error } = await service.from("users").select("id, marina_id").eq("email", normalized).maybeSingle();
  if (error) return { error: error.message };
  const user = userRow as { id: string; marina_id: string | null } | null;

  if (user) {
    if (user.marina_id === marinaId) return {};
    if (user.marina_id) return { error: `${normalized} is already staff at another marina. Remove them there first.` };
    const { error: updateError } = await service.from("users").update({ marina_id: marinaId }).eq("id", user.id);
    if (updateError) return { error: updateError.message };
    revalidatePath("/admin/marinas");
    return {};
  }

  // Signing up doesn't create a public.users row — only registering a
  // vessel or accepting a transfer does — so a harbormaster who has just
  // made an account has none. Find their Auth account (a read), then
  // create the row the same way those two paths do.
  const authId = await findAuthUserIdByEmail(service, normalized);
  if (!authId) return { error: `No Moxie account uses ${normalized}. Ask them to sign up at moxieyacht.com first.` };
  const fullName =
    normalized
      .split("@")[0]
      ?.replace(/[._-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (c) => c.toUpperCase()) || "Marina staff";
  const { error: insertError } = await service
    .from("users")
    .insert({ id: authId, email: normalized, full_name: fullName, role: "owner", marina_id: marinaId });
  if (insertError) return { error: insertError.message };
  revalidatePath("/admin/marinas");
  return {};
}

async function findAuthUserIdByEmail(
  service: ReturnType<typeof requireSupabaseServiceClient>,
  email: string,
): Promise<string | null> {
  const perPage = 1000;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await service.auth.admin.listUsers({ page, perPage });
    if (error) throw new Error(`Couldn't read accounts: ${error.message}`);
    const match = data.users.find((u) => u.email?.trim().toLowerCase() === email);
    if (match) return match.id;
    if (data.users.length < perPage) return null;
  }
  return null;
}

/** A leaver loses the roster at once; the marina's grants are untouched (spec §2.3). */
export async function detachMarinaStaff(userId: string): Promise<Result> {
  const service = await adminService();
  if (!service) return { error: "Admins only." };
  const { error } = await service.from("users").update({ marina_id: null }).eq("id", userId);
  if (error) return { error: error.message };
  revalidatePath("/admin/marinas");
  return {};
}
