-- Sync is_admin_email() with the ADMIN_EMAILS change Ben has already
-- made in Vercel: admin@moxieyachting.com added, ben@moxieyachting.com
-- removed. This function can't read process.env (see its original
-- definition, 20260911_admin_vessel_cap_exemption.sql), so it has to be
-- updated by hand here to match.
--
-- Scope reminder from that original migration: this only gates the
-- admin vessel-cap exemption (reactivate_vessel, accept_ownership_
-- transfer), not admin route access — that's requireAdmin() in
-- lib/admin-verify.ts, which reads ADMIN_EMAILS directly at request time
-- and needs no SQL-side change.
--
-- Safe to run independently of 20260916_demote_ben_and_cleanup_test_
-- vessels.sql — order between the two doesn't matter, they touch
-- different things.

CREATE OR REPLACE FUNCTION is_admin_email(p_email TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT lower(trim(p_email)) = ANY (ARRAY['admin@moxieyachting.com']);
$$;

COMMENT ON FUNCTION is_admin_email IS
  'Mirrors ADMIN_EMAILS from web/.env.local / Vercel env — keep in sync by hand. Used only for the admin vessel-cap exemption, not full admin auth (see lib/admin-verify.ts for the real, redundant admin check).';
