-- The public key can no longer read `vessels`.
--
-- anon (and authenticated — a signed-in browser holds the same public key
-- plus a JWT) had table-level SELECT on vessels, and the only RLS rule was
-- row-level: "Public read active vessels" USING (is_public = true), from
-- 20260825. No column restriction. So anyone holding the anon key — it ships
-- in the browser bundle — could GET /rest/v1/vessels?select=* and read every
-- column of every public row. Checked 2026-09-24 with the anon key: all 11
-- vessels readable, mailing_zip non-null on 3 of them. The scan page only
-- rendered an allow-list (filterVesselForRole); that allow-list never
-- applied to a direct REST read.
--
-- The scan page, /api/vessels/[mxeId] and /api/vessels/[mxeId]/preview now
-- read through the service role (lib/vessel-service.ts) and apply the same
-- is_public = true row rule in the query. Nothing else in the app reads
-- vessels with the public key (lib/supabase/service.guard.test.mts pins
-- the remaining public-client callers: waitlist insert, users self-read).
--
-- WHAT CHANGES
--   * SELECT on vessels revoked from anon and authenticated, table-level and
--     any column-level grant. They get 42501, the same answer
--     service_records, marina_vessel_access etc. already give.
--   * The "Public read active vessels" policy is dropped. With no grant it
--     is inert, but left in place it would silently re-expose every column
--     the moment anyone re-granted SELECT. With RLS on and no policy, a
--     re-grant alone returns zero rows.
--   * Not touched: INSERT/UPDATE/DELETE grants. They are already useless to
--     anon/authenticated — RLS is enabled with no write policy — and were
--     not part of this change.
--   * Existing rows: none change. No data is read, written or deleted.
--
-- DEPLOY ORDER: run AFTER the commit that moves lib/vessel-service.ts to the
-- service role is live on Vercel. Run before it, and every scan page 500s
-- (the old anon read gets 42501, which fetchVesselByMxeId throws on).
--
-- VERIFY AFTERWARDS: GET /rest/v1/vessels?select=mxe_id with the anon key
-- must return 42501 "permission denied for table vessels".

BEGIN;

REVOKE SELECT ON TABLE public.vessels FROM anon, authenticated;

-- Column-level SELECT grants survive a table-level REVOKE; clear any.
DO $$
DECLARE
  col text;
BEGIN
  FOR col IN
    SELECT attname FROM pg_attribute
     WHERE attrelid = 'public.vessels'::regclass AND attnum > 0 AND NOT attisdropped
  LOOP
    EXECUTE format('REVOKE SELECT (%I) ON TABLE public.vessels FROM anon, authenticated', col);
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Public read active vessels" ON public.vessels;

-- Guard: roll the whole file back unless the end state is exactly this.
DO $$
DECLARE
  remaining int;
BEGIN
  IF has_any_column_privilege('anon', 'public.vessels', 'SELECT') THEN
    RAISE EXCEPTION 'anon can still SELECT from vessels. Rolling back.';
  END IF;

  IF has_any_column_privilege('authenticated', 'public.vessels', 'SELECT') THEN
    RAISE EXCEPTION 'authenticated can still SELECT from vessels. Rolling back.';
  END IF;

  IF NOT has_table_privilege('service_role', 'public.vessels', 'SELECT') THEN
    RAISE EXCEPTION 'service_role cannot SELECT from vessels. Rolling back.';
  END IF;

  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.vessels'::regclass) THEN
    RAISE EXCEPTION 'RLS is not enabled on vessels. Rolling back.';
  END IF;

  SELECT count(*) INTO remaining
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'vessels' AND cmd IN ('SELECT', 'ALL');
  IF remaining <> 0 THEN
    RAISE EXCEPTION 'vessels still has % SELECT policy/policies. Rolling back.', remaining;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
