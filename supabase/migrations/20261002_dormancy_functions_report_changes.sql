-- Dormancy functions report what they changed, so notifications have a moment
-- to fire at.
--
-- downgrade_grace_started, vessel_locked and vessel_reactivated were declared
-- and never raised, because the functions that cause those events returned
-- VOID: no caller could tell a clock it started from one already running, or
-- which vessels it had just locked or restored. This changes what five
-- functions RETURN. Their logic is unchanged — each body is the latest
-- definition (20260913 / 20260914) with the result captured instead of
-- discarded.
--
--   reconcile_vessel_overflow  VOID -> JSONB   {started, running, grace_until, active_count, vessel_limit, exempt}
--   apply_overflow_fallback    VOID -> UUID[]  the vessels this call locked
--   clear_vessels_lapsed       VOID -> UUID[]  the vessels this call restored
--   reconcile_owner_dormancy   VOID -> UUID[]  the vessels its fallback locked
--   reconcile_all_dormancy     VOID -> TABLE(owner_id, locked_ids), one row per owner that had any
--
-- An id is returned only by the call that changed the row: every UPDATE is
-- guarded on the "before" state and serialised on the owner's advisory lock,
-- so a second or concurrent call finds nothing to change and returns an
-- empty array. That is what makes it safe to notify from a page render.
--
-- ONE COLUMN: users.downgrade_grace_notified_for
--
-- The grace-started notification is driven by stored state, not by the
-- `started` flag above — see the note on the column. `started` is still
-- returned, for logs and tests.
--
-- EXECUTE GRANTS
--
-- A return type cannot be changed by CREATE OR REPLACE, so each function is
-- DROPPED and CREATED. A newly created function is executable by PUBLIC,
-- which is how anon could call next_mxe_id() before 20260923 closed it. The
-- 20260923 lockdown is re-applied to all five below, in this same
-- transaction, and a guard block rolls the whole file back if any of them
-- ends up with other than exactly one definition, or executable by anon or
-- authenticated, or not executable by service_role.
--
-- plpgsql does not record dependencies on functions it calls, so the drops do
-- not cascade into callers; clear_vessels_lapsed, reconcile_owner_dormancy and
-- reconcile_all_dormancy call the others with PERFORM or SELECT INTO and pick
-- up the new definitions as soon as this commits.
--
-- DEPLOY ORDER: either. The application treats a NULL result (the old VOID)
-- as "nothing changed" and skips the grace notification, with a log line,
-- until downgrade_grace_notified_for exists. Nothing breaks before this runs;
-- nothing notifies either.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- The claim column.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE users ADD COLUMN IF NOT EXISTS downgrade_grace_notified_for TIMESTAMPTZ;

COMMENT ON COLUMN users.downgrade_grace_notified_for IS
  'The downgrade_grace_until value the owner has been told about. A grace clock is notified exactly once: the notifier claims it by setting this equal to downgrade_grace_until, guarded on the two differing. A new clock has a new downgrade_grace_until, so it differs again and is notified again — nothing ever has to reset this.';

-- ─────────────────────────────────────────────────────────────────────────
-- Drop, callers first. Signatures are unchanged; only return types move.
-- ─────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.reconcile_all_dormancy();
DROP FUNCTION IF EXISTS public.reconcile_owner_dormancy(UUID);
DROP FUNCTION IF EXISTS public.clear_vessels_lapsed(UUID);
DROP FUNCTION IF EXISTS public.apply_overflow_fallback(UUID);
DROP FUNCTION IF EXISTS public.reconcile_vessel_overflow(UUID);

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_vessel_overflow
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reconcile_vessel_overflow(p_owner_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier     TEXT;
  owner_email    TEXT;
  limit_for_tier INTEGER;
  active_count   INTEGER;
  v_until        TIMESTAMPTZ;
  v_started      BOOLEAN := false;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, email INTO owner_tier, owner_email FROM users WHERE id = p_owner_id;
  IF is_admin_email(owner_email) THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN jsonb_build_object('started', false, 'running', false, 'grace_until', NULL, 'exempt', true);
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count <= limit_for_tier THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN jsonb_build_object(
      'started', false, 'running', false, 'grace_until', NULL,
      'active_count', active_count, 'vessel_limit', limit_for_tier, 'exempt', false
    );
  END IF;

  -- Guarded on IS NULL, so only the call that starts the clock sets it —
  -- and only that call gets a row back.
  UPDATE users
    SET downgrade_grace_until = now() + INTERVAL '14 days'
    WHERE id = p_owner_id AND downgrade_grace_until IS NULL
    RETURNING downgrade_grace_until INTO v_until;
  v_started := FOUND;

  IF NOT v_started THEN
    SELECT downgrade_grace_until INTO v_until FROM users WHERE id = p_owner_id;
  END IF;

  RETURN jsonb_build_object(
    'started', v_started, 'running', true, 'grace_until', v_until,
    'active_count', active_count, 'vessel_limit', limit_for_tier, 'exempt', false
  );
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- apply_overflow_fallback
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.apply_overflow_fallback(p_owner_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier     TEXT;
  owner_email    TEXT;
  limit_for_tier INTEGER;
  grace_until    TIMESTAMPTZ;
  v_locked       UUID[];
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, downgrade_grace_until, email INTO owner_tier, grace_until, owner_email FROM users WHERE id = p_owner_id;

  IF is_admin_email(owner_email) THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN '{}'::UUID[];
  END IF;

  IF grace_until IS NULL OR grace_until > now() THEN
    RETURN '{}'::UUID[];
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY updated_at DESC) AS rn
    FROM vessels
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active'
  ), locked AS (
    UPDATE vessels
      SET lifecycle_status = 'dormant', dormant_cause = 'locked', dormant_since = now()
      WHERE id IN (SELECT id FROM ranked WHERE rn > limit_for_tier)
      RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::UUID[]) INTO v_locked FROM locked;

  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'locked'
      );

  -- Cleared whether or not anything locked, exactly as before — which is
  -- also why a second call returns an empty array: the grace check above
  -- stops it.
  UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;

  RETURN v_locked;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- clear_vessels_lapsed
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.clear_vessels_lapsed(p_owner_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_restored UUID[];
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  WITH restored AS (
    UPDATE vessels
      SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
      WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed'
      RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}'::UUID[]) INTO v_restored FROM restored;

  UPDATE users SET past_due_since = NULL WHERE id = p_owner_id;

  -- May start a grace clock. Not returned from here: the grace notification
  -- is driven by stored state, and the caller checks that state afterwards.
  PERFORM reconcile_vessel_overflow(p_owner_id);

  RETURN v_restored;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_owner_dormancy
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reconcile_owner_dormancy(p_owner_id UUID)
RETURNS UUID[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_locked UUID[];
BEGIN
  -- The past-due lapse still reports nothing: its functions return VOID and
  -- are not changed here. See the application note on vessel_lapsed.
  PERFORM apply_past_due_dormancy_if_expired(p_owner_id);
  SELECT apply_overflow_fallback(p_owner_id) INTO v_locked;
  RETURN coalesce(v_locked, '{}'::UUID[]);
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- reconcile_all_dormancy
-- ─────────────────────────────────────────────────────────────────────────
CREATE FUNCTION public.reconcile_all_dormancy()
RETURNS TABLE (owner_id UUID, locked_ids UUID[])
LANGUAGE plpgsql
AS $$
DECLARE
  r        RECORD;
  v_locked UUID[];
BEGIN
  FOR r IN SELECT u.id FROM users u WHERE u.subscription_status = 'past_due' LOOP
    PERFORM apply_past_due_dormancy_if_expired(r.id);
  END LOOP;

  FOR r IN SELECT u.id FROM users u WHERE u.downgrade_grace_until IS NOT NULL AND u.downgrade_grace_until < now() LOOP
    SELECT apply_overflow_fallback(r.id) INTO v_locked;
    IF coalesce(array_length(v_locked, 1), 0) > 0 THEN
      owner_id := r.id;
      locked_ids := v_locked;
      RETURN NEXT;
    END IF;
  END LOOP;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- Re-apply the 20260923 lockdown. Every function above was just created,
-- so each is currently executable by PUBLIC.
-- ─────────────────────────────────────────────────────────────────────────
REVOKE EXECUTE ON FUNCTION public.reconcile_vessel_overflow(UUID) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_overflow_fallback(UUID)   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.clear_vessels_lapsed(UUID)      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_owner_dormancy(UUID)  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reconcile_all_dormancy()        FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.reconcile_vessel_overflow(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION public.apply_overflow_fallback(UUID)   TO service_role;
GRANT EXECUTE ON FUNCTION public.clear_vessels_lapsed(UUID)      TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_owner_dormancy(UUID)  TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_all_dormancy()        TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard: fail the whole transaction rather than leave an overload or an
-- open grant.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  f          RECORD;
  overloads  INTEGER;
BEGIN
  FOR f IN
    SELECT * FROM (VALUES
      ('reconcile_vessel_overflow', 'public.reconcile_vessel_overflow(uuid)',  'jsonb'),
      ('apply_overflow_fallback',   'public.apply_overflow_fallback(uuid)',    'uuid[]'),
      ('clear_vessels_lapsed',      'public.clear_vessels_lapsed(uuid)',       'uuid[]'),
      ('reconcile_owner_dormancy',  'public.reconcile_owner_dormancy(uuid)',   'uuid[]'),
      ('reconcile_all_dormancy',    'public.reconcile_all_dormancy()',         'record')
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
END $$;

COMMIT;

-- PostgREST caches function signatures. Supabase reloads on DDL, but say so
-- explicitly: a stale cache would keep returning the old VOID shape.
NOTIFY pgrst, 'reload schema';
