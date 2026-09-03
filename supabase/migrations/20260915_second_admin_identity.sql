-- Second admin identity: admin@moxieyachting.com, alongside the existing
-- ben@moxieyachting.com admin — not a replacement. Ben demotes the old one
-- in a separate step once this one is confirmed working.
--
-- PRECONDITION: Ben must sign up with admin@moxieyachting.com through the
-- normal app signup flow FIRST, so its auth.users row exists. Run this
-- only after that — the DO block below raises a clear error if the
-- auth.users row isn't there yet, rather than silently doing nothing.
--
-- This intentionally does NOT hardcode a placeholder UUID for `id` the
-- way the original seed.sql did for ben@moxieyachting.com — that's
-- exactly what caused the current mismatch between that account's real
-- Supabase Auth id and its public.users.id (see lib/admin-verify.ts's
-- comment on requireAdmin(), "build spec §9-C-13"). This migration reads
-- the real id from auth.users by email instead, so this identity doesn't
-- inherit the same bug.
--
-- Two more things this does NOT do, both deliberately out of scope here:
--   1. Add admin@moxieyachting.com to the ADMIN_EMAILS Vercel env var —
--      requireAdmin() requires both that AND this row's role='admin' to
--      reach any admin route. That's a Vercel dashboard change outside
--      this repo; Ben/his brother need to add it by hand.
--   2. Add admin@moxieyachting.com to is_admin_email() in
--      20260911_admin_vessel_cap_exemption.sql — that function only
--      gates the vessel-cap exemption on reactivate/transfer-accept, not
--      admin route access. Update it separately if this identity should
--      also get that exemption; not assumed here.

DO $$
DECLARE
  target_auth_id UUID;
BEGIN
  SELECT id INTO target_auth_id FROM auth.users WHERE lower(email) = 'admin@moxieyachting.com';

  IF target_auth_id IS NULL THEN
    RAISE EXCEPTION 'No auth.users row for admin@moxieyachting.com yet — have Ben sign up with that email through the app first, then re-run this migration.';
  END IF;

  INSERT INTO users (id, email, full_name, role, subscription_tier, subscription_status, preferred_contact)
  VALUES (target_auth_id, 'admin@moxieyachting.com', 'Admin', 'admin', 'full', 'active', 'email')
  ON CONFLICT (email) DO UPDATE SET
    id = EXCLUDED.id,
    role = 'admin',
    subscription_tier = 'full',
    subscription_status = 'active';
END $$;
