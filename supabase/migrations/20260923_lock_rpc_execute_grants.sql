-- Moxie Digital: lock every PostgREST-exposed function to service_role.
--
-- CREATE FUNCTION grants EXECUTE to PUBLIC by default, and PostgREST
-- publishes every function in the exposed schema as an RPC endpoint.
-- There has never been a REVOKE or GRANT statement anywhere in this
-- migration history, so all twenty functions below are currently
-- callable by anyone holding the publishable anon key — which ships in
-- every page's JavaScript bundle.
--
-- CONFIRMED, not assumed: with the anon key, vessel_limit_for_tier() and
-- is_admin_email() both execute and return values today. Both are
-- side-effect-free by inspection, which is why they were the ones used
-- to establish that anon RPC execution is live on this project.
--
-- ────────────────────────────────────────────────────────────────────────────
-- WHY THIS IS NOT MERELY TIDINESS
--
-- Most of these are SECURITY INVOKER and write to tables with RLS
-- enabled, so an anon call fails at the first write. That is real
-- protection, but it is protection that arrives by accident: it depends
-- on RLS being enabled on every table each function touches, on nobody
-- later marking one SECURITY DEFINER for convenience, and on the
-- statement order inside each function. None of those is enforced.
--
-- Two functions are not protected by that accident at all:
--
--   next_mxe_id()
--     Touches only a sequence, and RLS DOES NOT APPLY TO SEQUENCES.
--     There is no backstop whatsoever. An unauthenticated caller can
--     burn permanent MXE IDs one per request. The five-digit space is
--     99,999 wide; exhausting it makes next_mxe_id() raise, at which
--     point EVERY new vessel registration fails permanently and cannot
--     be repaired, because IDs are never reused by design
--     (20260904_mxe_id_sequence.sql). This is the reason this migration
--     exists.
--
--   apply_vessel_identity_correction()
--     The only SECURITY DEFINER function in the codebase, so RLS is
--     bypassed inside it entirely. Practically mitigated only by needing
--     an unguessable request UUID — which is obscurity, not a control.
--
-- ────────────────────────────────────────────────────────────────────────────
-- SAFETY: every caller was verified before writing this
--
-- All twenty are invoked from server-side code only, through a client
-- built by createSupabaseServiceClient(). Verified three ways:
--
--   1. Every file containing a .rpc() call was checked for "use client".
--      None is a client component.
--   2. Every .rpc() call site's client variable traces to
--      createSupabaseServiceClient (including lib/mxe-id.ts, where the
--      variable is merely named `supabase`).
--   3. All 17 files that build a browser client were searched for
--      .rpc(). None calls one — there is no anon/authenticated RPC path
--      in the application at all.
--
-- Five functions have no application caller and are invoked only from
-- inside other functions: apply_overflow_fallback,
-- apply_past_due_dormancy_if_expired, is_admin_email,
-- reconcile_vessel_overflow, vessel_limit_for_tier. Nested calls in a
-- SECURITY INVOKER function execute with the caller's privileges, which
-- is service_role, and the GRANT below covers exactly that.
--
-- No trigger function calls any of these (the one trigger,
-- log_vessel_identity_changes, makes no nested calls), and there is no
-- pg_cron schedule in this project. The table owner keeps EXECUTE
-- regardless, so the SQL editor is unaffected.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Signatures are resolved from pg_proc rather than transcribed, so a
-- typo cannot silently revoke the wrong overload or miss one. The list
-- below is names only; the final count check fails the whole migration
-- if the list and the database disagree.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  target_names TEXT[] := ARRAY[
    'accept_ownership_transfer',
    'apply_overflow_fallback',
    'apply_past_due_dormancy_if_expired',
    'apply_vessel_decommission',
    'apply_vessel_identity_correction',
    'choose_active_vessels',
    'clear_vessels_lapsed',
    'complete_ownership_transfer',
    'delete_unactivated_vessel',
    'is_admin_email',
    'mint_badge_batch',
    'next_mxe_id',
    'reactivate_vessel',
    'reconcile_all_dormancy',
    'reconcile_owner_dormancy',
    'reconcile_vessel_overflow',
    'resolve_vessel_share',
    'reverse_ownership_transfer',
    'set_vessels_lapsed',
    'vessel_limit_for_tier'
  ];
  fn            RECORD;
  locked        INTEGER := 0;
  names_found   INTEGER;
  names_wanted  INTEGER := array_length(target_names, 1);
BEGIN
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
      FROM pg_proc p
      JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public'
       AND p.proname = ANY(target_names)
       AND p.prokind = 'f'          -- plain functions only, never triggers/aggregates
     ORDER BY p.proname
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', fn.signature);
    -- Granted explicitly rather than relying on Supabase's default
    -- privileges having reached service_role independently of PUBLIC.
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    locked := locked + 1;
    RAISE NOTICE 'locked to service_role: %', fn.signature;
  END LOOP;

  SELECT count(DISTINCT p.proname)
    INTO names_found
    FROM pg_proc p
    JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname = ANY(target_names)
     AND p.prokind = 'f';

  RAISE NOTICE '% function(s) locked, covering % of % named', locked, names_found, names_wanted;

  -- Fail the whole migration rather than half-lock the surface. A
  -- shortfall means either a name here is wrong or an earlier migration
  -- has not been run — 20260922_mint_badge_batch.sql in particular must
  -- run before this one.
  IF names_found <> names_wanted THEN
    RAISE EXCEPTION
      'Expected % named functions in public, found %. Nothing has been changed. Check that 20260922_mint_badge_batch.sql has been run.',
      names_wanted, names_found;
  END IF;
END $$;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Verify after running:
--
--   -- Expect ZERO rows. Any row here is a function still reachable with
--   -- the publishable anon key.
--   SELECT routine_name, grantee
--     FROM information_schema.routine_privileges
--    WHERE specific_schema = 'public'
--      AND grantee IN ('PUBLIC', 'anon', 'authenticated')
--      AND privilege_type = 'EXECUTE';
--
--   -- Expect 20 rows, all grantee = service_role.
--   SELECT routine_name, grantee
--     FROM information_schema.routine_privileges
--    WHERE specific_schema = 'public' AND grantee = 'service_role'
--    ORDER BY routine_name;
--
-- Then confirm the application still works end to end. The paths that
-- exercise these are: registering a vessel (next_mxe_id), the admin
-- dashboard (reconcile_all_dormancy), opening a vessel profile
-- (reconcile_owner_dormancy), and a share link (resolve_vessel_share).
--
-- NOTE ON FUTURE FUNCTIONS: this locks the twenty that exist today. A
-- function added by a later migration will again default to PUBLIC
-- EXECUTE unless its own migration revokes it. Making that durable
-- needs
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--
-- which is deliberately NOT included here: it changes the default for
-- everything created afterwards, including by other tools, and that is
-- a standing policy decision rather than part of this sweep.
-- ────────────────────────────────────────────────────────────────────────────
