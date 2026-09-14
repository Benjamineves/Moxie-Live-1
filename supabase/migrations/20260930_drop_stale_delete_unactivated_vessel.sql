-- Drop the stale delete_unactivated_vessel(p_vessel_id, p_owner_id).
--
-- 20260909 created delete_unactivated_vessel(UUID, UUID) for the owner's
-- "delete unpaid vessel" button. 20260927 wrote the badge-reclaim version
-- as CREATE OR REPLACE with a DIFFERENT signature — (UUID, TEXT, TEXT) —
-- which does not replace anything: Postgres keeps both as overloads. The
-- owner action kept calling the old one. Confirmed live before writing
-- this, with a read-only call that resolved to the old overload.
--
-- What the old one did, and why it goes:
--   - no Stripe check (a paid-but-unrecorded checkout could be deleted);
--   - DELETE FROM vessel_payments for the vessel — destroying the record a
--     refund would start from;
--   - no badge handling at all, so on every vessel created since 7a its
--     DELETE FROM vessels hit badge_identities.vessel_id's foreign key and
--     failed, showing the owner a raw database error.
--
-- The owner action now goes through lib/unpaid-vessel-delete.ts, which runs
-- the Stripe check and calls the (UUID, TEXT, TEXT) version — the same path
-- as the admin reclaim. Nothing else calls the old one: no application code
-- (a test enforces that only the shared helper calls this function at all)
-- and no SQL function.
--
-- DEPLOY ORDER: either. The application change only calls the current
-- version, which already exists, so it works before this runs. This only
-- removes the overload nothing calls any more.
--
-- EXECUTE GRANTS: nothing is created, so nothing is reset to PUBLIC. The
-- block below still checks that exactly the current version remains and
-- that anon and authenticated cannot execute it, and rolls back if not.

BEGIN;

DROP FUNCTION IF EXISTS public.delete_unactivated_vessel(UUID, UUID);

DO $$
DECLARE
  remaining INTEGER;
BEGIN
  SELECT count(*) INTO remaining
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'delete_unactivated_vessel';
  IF remaining <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one delete_unactivated_vessel after the drop, found %. Rolling back.', remaining;
  END IF;

  IF to_regprocedure('public.delete_unactivated_vessel(uuid, text, text)') IS NULL THEN
    RAISE EXCEPTION 'The remaining delete_unactivated_vessel is not (uuid, text, text). Rolling back.';
  END IF;

  IF has_function_privilege('anon', 'public.delete_unactivated_vessel(uuid, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.delete_unactivated_vessel(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'delete_unactivated_vessel is executable by anon or authenticated. Rolling back.';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.delete_unactivated_vessel(uuid, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute delete_unactivated_vessel. Rolling back.';
  END IF;
END $$;

COMMIT;
