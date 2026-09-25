-- The public key gets nothing in the public schema, now and for every object
-- created from here on.
--
-- LIVE BEFORE THIS (security snapshot 2026-09-25 05:06 UTC):
--   * anon + authenticated held SELECT/INSERT/UPDATE/DELETE/TRUNCATE/
--     REFERENCES/TRIGGER on 17 public tables, and everything but SELECT on
--     vessels (18 in all; the other 8 tables were already closed by the
--     migrations that created them). RLS stopped rows moving, but
--     RLS does not cover TRUNCATE, and the grants were one missed
--     `ENABLE ROW LEVEL SECURITY` away from an open table.
--   * mxe_id_seq: USAGE + UPDATE (nextval/setval) for both roles.
--   * Two trigger functions executable by both (update_updated_at,
--     log_vessel_identity_changes). Not callable over the API; revoked for
--     tidiness — Postgres checks EXECUTE on a trigger function only at
--     CREATE TRIGGER, never when it fires.
--   * DEFAULT PRIVILEGES for role postgres in public: ALL on new tables,
--     rwU on new sequences, EXECUTE on new functions, to anon and
--     authenticated. Every migration runs as postgres, so each new object was
--     born open and relied on its own migration to close it (next_mxe_id()
--     was the one that didn't).
--   * Three SELECT policies — ownership_history, vessel_documents,
--     vessel_payments — look up `vessels` in a subquery. Since 20261010
--     revoked SELECT on vessels they raise 42501 for any signed-in caller
--     (observed 2026-09-25 with a real session). Nothing uses them.
--
-- WHAT THE APP NEEDS FROM THESE ROLES IN public: nothing. Every table read
-- and write goes through the service role (lib/supabase/service.guard.test
-- pins the only anon-client caller left, owner-verify's users fallback,
-- which already gets zero rows and treats an error the same way). Storage
-- uploads use the storage schema, which this file does not touch.
--
-- AFTER
--   * ALL on every public table/view, ALL on every public sequence, EXECUTE
--     on every public function: revoked from anon and authenticated (and
--     EXECUTE from PUBLIC).
--   * Default privileges for postgres: the same, for future objects —
--     schema-level for anon/authenticated, and globally for PUBLIC's
--     EXECUTE on functions (PUBLIC's default is global, not per-schema).
--     supabase_admin's own defaults can't be changed from the SQL editor;
--     they only affect objects supabase_admin creates, which our migrations
--     don't.
--   * The three erroring policies dropped. RLS stays enabled everywhere.
--   * The guard CREATES a scratch table, sequence and function inside this
--     transaction to prove new objects are born closed, then drops them.
--
-- EXISTING ROWS: none change. DEPLOY ORDER: any time after 32cf6df (the
-- waitlist route stopped using the anon key) is live — run it after that.
-- ROLLBACK: supabase/rollbacks/20261013_close_public_schema_grants.rollback.sql

BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC, anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

DROP POLICY IF EXISTS "Owners read own ownership history" ON public.ownership_history;
DROP POLICY IF EXISTS "Owners read own vessel documents" ON public.vessel_documents;
DROP POLICY IF EXISTS "Owners read own vessel payments" ON public.vessel_payments;

-- Guard: roll the whole file back unless the end state is exactly this.
DO $$
DECLARE
  r record;
  n int;
BEGIN
  -- Every public table has RLS on.
  FOR r IN
    SELECT c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity
  LOOP
    RAISE EXCEPTION 'public.% has row level security OFF. Rolling back.', r.relname;
  END LOOP;

  -- No public relation grants anything to anon/authenticated, at table or
  -- column level.
  FOR r IN
    SELECT c.oid, c.relname, role
      FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace,
           unnest(ARRAY['anon', 'authenticated']) AS role
     WHERE ns.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  LOOP
    IF has_any_column_privilege(r.role, r.oid, 'SELECT, INSERT, UPDATE, REFERENCES')
       OR has_table_privilege(r.role, r.oid, 'DELETE, TRUNCATE, TRIGGER') THEN
      RAISE EXCEPTION '% still has privileges on public.%. Rolling back.', r.role, r.relname;
    END IF;
  END LOOP;

  FOR r IN
    SELECT c.oid, c.relname FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relkind = 'S'
  LOOP
    IF has_sequence_privilege('anon', r.oid, 'USAGE, SELECT, UPDATE')
       OR has_sequence_privilege('authenticated', r.oid, 'USAGE, SELECT, UPDATE') THEN
      RAISE EXCEPTION 'anon/authenticated can still use sequence public.%. Rolling back.', r.relname;
    END IF;
  END LOOP;

  FOR r IN
    SELECT p.oid, p.oid::regprocedure AS sig FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
  LOOP
    IF has_function_privilege('anon', r.oid, 'EXECUTE') OR has_function_privilege('authenticated', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon/authenticated. Rolling back.', r.sig;
    END IF;
    IF NOT has_function_privilege('service_role', r.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role lost EXECUTE on %. Rolling back.', r.sig;
    END IF;
  END LOOP;

  -- The service role keeps what the app uses.
  IF NOT has_table_privilege('service_role', 'public.vessels', 'SELECT, INSERT, UPDATE, DELETE') THEN
    RAISE EXCEPTION 'service_role lost privileges on vessels. Rolling back.';
  END IF;

  SELECT count(*) INTO n FROM pg_policies
   WHERE schemaname = 'public' AND qual ~ '\mvessels\M' AND tablename <> 'vessels';
  IF n <> 0 THEN
    RAISE EXCEPTION '% public policy/policies still subquery vessels. Rolling back.', n;
  END IF;

  -- New objects are born closed: create one of each, check, drop.
  CREATE TABLE public.zz_grant_probe (id int);
  CREATE SEQUENCE public.zz_grant_probe_seq;
  CREATE FUNCTION public.zz_grant_probe_fn() RETURNS int LANGUAGE sql AS 'SELECT 1';
  IF has_any_column_privilege('anon', 'public.zz_grant_probe', 'SELECT, INSERT, UPDATE, REFERENCES')
     OR has_table_privilege('authenticated', 'public.zz_grant_probe', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')
     OR has_sequence_privilege('anon', 'public.zz_grant_probe_seq', 'USAGE, UPDATE')
     OR has_sequence_privilege('authenticated', 'public.zz_grant_probe_seq', 'USAGE, UPDATE')
     OR has_function_privilege('anon', 'public.zz_grant_probe_fn()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.zz_grant_probe_fn()', 'EXECUTE') THEN
    RAISE EXCEPTION 'A newly created table, sequence or function is still open to anon/authenticated. Rolling back.';
  END IF;
  DROP FUNCTION public.zz_grant_probe_fn();
  DROP SEQUENCE public.zz_grant_probe_seq;
  DROP TABLE public.zz_grant_probe;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
