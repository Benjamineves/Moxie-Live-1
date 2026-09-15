-- The past-due lapse reports what it paused, and a restore reports why.
--
-- When the 7-day past-due grace expires, apply_past_due_dormancy_if_expired
-- pauses every active vessel on the account — and returned VOID, so nothing
-- could tell the owner. They had a payment-failure email at the start of the
-- window and then heard nothing until their boats were paused. This is the
-- same gap 20261002 closed for overflow locking, closed the same way.
--
-- Five functions change what they RETURN. Logic is unchanged apart from
-- capturing results — bodies are the live definitions (set_vessels_lapsed
-- 20260914, apply_past_due_dormancy_if_expired 20260913, the other three
-- 20261002).
--
--   set_vessels_lapsed                  VOID   -> UUID[]  vessels this call paused
--   apply_past_due_dormancy_if_expired  VOID   -> UUID[]  vessels this call paused ('{}' inside the grace window)
--   clear_vessels_lapsed                UUID[] -> JSONB   {restored_ids, recovered_from_past_due}
--   reconcile_owner_dormancy            UUID[] -> JSONB   {locked_ids, lapsed_ids}
--   reconcile_all_dormancy              TABLE(owner_id, locked_ids) -> TABLE(owner_id, locked_ids, lapsed_ids)
--
-- ONLY THE CALL THAT PAUSES GETS THE IDS. set_vessels_lapsed's UPDATE is
-- guarded on lifecycle_status = 'active' and serialised on the owner's
-- advisory lock. After the grace window expires the account stays past_due,
-- so every later page load re-runs the lapse — and finds nothing active to
-- pause, and returns '{}'. (A vessel that becomes active after that, say a
-- newly paid badge, is paused and reported on the next load. That is a real
-- new event.)
--
-- recovered_from_past_due
--
-- vessel_reactivated was in-app only because the owner is on screen when they
-- resubscribe. That is not true when Stripe recovers a failed payment on its
-- own. The two restores are told apart by users.past_due_since, read inside
-- the same transaction that clears it:
--   - the past-due lapse leaves past_due_since set (the account is still
--     past_due), so a restore that finds it set is a recovered payment on the
--     same subscription;
--   - the cancellation lapse clears past_due_since (the webhook's lapse
--     branch), so a restore that finds it NULL follows a new subscription —
--     the owner resubscribing, deliberately, at checkout.
-- Because it is read and cleared in one transaction, a failed restore rolls
-- back with the flag intact, and a webhook retry classifies it the same way.
-- Known limit: a subscription that went to Stripe's 'unpaid' state (which
-- this app records as canceled, clearing past_due_since) and is later paid
-- reads as a resubscription. See the dormant identity spec, §8.
--
-- EXECUTE GRANTS
--
-- Return types cannot change under CREATE OR REPLACE, so all five are DROPPED
-- and CREATED, which makes each executable by PUBLIC. The 20260923 lockdown
-- is re-applied below, in this transaction, and a guard block rolls the whole
-- file back if any function has other than one definition, the wrong return
-- type or columns, or the wrong grants.
--
-- DEPLOY ORDER: either. The application reads both the 20261002 result shapes
-- and these, so it works before and after this runs.

BEGIN;

DROP FUNCTION IF EXISTS public.reconcile_all_dormancy();
DROP FUNCTION IF EXISTS public.reconcile_owner_dormancy(UUID);
DROP FUNCTION IF EXISTS public.clear_vessels_lapsed(UUID);
DROP FUNCTION IF EXISTS public.apply_past_due_dormancy_if_expired(UUID);
DROP FUNCTION IF EXISTS public.set_vessels_lapsed(UUID);

-- ─────────────────────────────────────────────────────────────────────────
-- set_vessels_lapsed
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.set_vessels_lapsed(p_owner_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_lapsed UUID[];
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  WITH lapsed AS (
    UPDATE vessels
      SET lifecycle_status = 'dormant', dormant_cause = 'lapsed', dormant_since = now()
      WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active'
      RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::UUID[]) INTO v_lapsed FROM lapsed;

  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed'
      );

  RETURN v_lapsed;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- apply_past_due_dormancy_if_expired
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.apply_past_due_dormancy_if_expired(p_owner_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
AS $$
DECLARE
  u RECORD;
BEGIN
  SELECT subscription_status, past_due_since INTO u FROM users WHERE id = p_owner_id;

  IF u.subscription_status IS DISTINCT FROM 'past_due' OR u.past_due_since IS NULL THEN
    RETURN '{}'::UUID[];
  END IF;
  -- PAST_DUE_GRACE_DAYS = 7, mirrored from lib/tier-config.ts.
  IF now() < u.past_due_since + INTERVAL '7 days' THEN
    RETURN '{}'::UUID[];
  END IF;

  RETURN set_vessels_lapsed(p_owner_id);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- clear_vessels_lapsed
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.clear_vessels_lapsed(p_owner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_restored        UUID[];
  v_past_due_lapse  BOOLEAN;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  -- Read before it is cleared below, under the same lock and transaction.
  SELECT past_due_since IS NOT NULL INTO v_past_due_lapse FROM users WHERE id = p_owner_id;

  WITH restored AS (
    UPDATE vessels
      SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
      WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed'
      RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::UUID[]) INTO v_restored FROM restored;

  UPDATE users SET past_due_since = NULL WHERE id = p_owner_id;

  PERFORM reconcile_vessel_overflow(p_owner_id);

  RETURN jsonb_build_object(
    'restored_ids', to_jsonb(v_restored),
    'recovered_from_past_due', coalesce(v_past_due_lapse, false)
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_owner_dormancy
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reconcile_owner_dormancy(p_owner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_lapsed UUID[];
  v_locked UUID[];
BEGIN
  SELECT apply_past_due_dormancy_if_expired(p_owner_id) INTO v_lapsed;
  SELECT apply_overflow_fallback(p_owner_id) INTO v_locked;
  RETURN jsonb_build_object(
    'locked_ids', to_jsonb(coalesce(v_locked, '{}'::UUID[])),
    'lapsed_ids', to_jsonb(coalesce(v_lapsed, '{}'::UUID[]))
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_all_dormancy
--
-- An owner in both loops gets two rows, one per kind of event, rather than a
-- merged one. They are different events with different notifications.
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reconcile_all_dormancy()
RETURNS TABLE (owner_id UUID, locked_ids UUID[], lapsed_ids UUID[])
LANGUAGE plpgsql
AS $$
DECLARE
  r     RECORD;
  v_ids UUID[];
BEGIN
  FOR r IN SELECT u.id FROM users u WHERE u.subscription_status = 'past_due' LOOP
    SELECT apply_past_due_dormancy_if_expired(r.id) INTO v_ids;
    IF coalesce(array_length(v_ids, 1), 0) > 0 THEN
      owner_id := r.id;
      locked_ids := '{}'::UUID[];
      lapsed_ids := v_ids;
      RETURN NEXT;
    END IF;
  END LOOP;

  FOR r IN SELECT u.id FROM users u WHERE u.downgrade_grace_until IS NOT NULL AND u.downgrade_grace_until < now() LOOP
    SELECT apply_overflow_fallback(r.id) INTO v_ids;
    IF coalesce(array_length(v_ids, 1), 0) > 0 THEN
      owner_id := r.id;
      locked_ids := v_ids;
      lapsed_ids := '{}'::UUID[];
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Re-apply the 20260923 lockdown.
-- ─────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.set_vessels_lapsed(UUID)                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_past_due_dormancy_if_expired(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_vessels_lapsed(UUID)               FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_owner_dormancy(UUID)           FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_all_dormancy()                 FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.set_vessels_lapsed(UUID)                 TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_past_due_dormancy_if_expired(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_vessels_lapsed(UUID)               TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_owner_dormancy(UUID)           TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_all_dormancy()                 TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f          RECORD;
  overloads  INTEGER;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('set_vessels_lapsed',                 'public.set_vessels_lapsed(uuid)',                 'uuid[]'),
      ('apply_past_due_dormancy_if_expired', 'public.apply_past_due_dormancy_if_expired(uuid)', 'uuid[]'),
      ('clear_vessels_lapsed',               'public.clear_vessels_lapsed(uuid)',               'jsonb'),
      ('reconcile_owner_dormancy',           'public.reconcile_owner_dormancy(uuid)',           'jsonb'),
      ('reconcile_all_dormancy',             'public.reconcile_all_dormancy()',                 'record')
    ) AS t(name, signature, returns)
  LOOP
    SELECT count(*) INTO overloads
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = f.name;
    IF overloads <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one %, found %. Rolling back.', f.name, overloads;
    END IF;

    IF to_regprocedure(f.signature) IS NULL THEN
      RAISE EXCEPTION '% does not exist with the expected signature. Rolling back.', f.signature;
    END IF;

    IF format_type((SELECT prorettype FROM pg_proc WHERE oid = to_regprocedure(f.signature)), NULL) <> f.returns THEN
      RAISE EXCEPTION '% does not return %. Rolling back.', f.signature, f.returns;
    END IF;

    IF has_function_privilege('anon', f.signature, 'EXECUTE')
       OR has_function_privilege('authenticated', f.signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon or authenticated. Rolling back.', f.signature;
    END IF;

    IF NOT has_function_privilege('service_role', f.signature, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %. Rolling back.', f.signature;
    END IF;
  END LOOP;

  -- 'record' alone does not prove the new column is there.
  IF pg_get_function_result(to_regprocedure('public.reconcile_all_dormancy()')) NOT LIKE '%lapsed_ids uuid[]%' THEN
    RAISE EXCEPTION 'reconcile_all_dormancy does not return lapsed_ids. Rolling back.';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
