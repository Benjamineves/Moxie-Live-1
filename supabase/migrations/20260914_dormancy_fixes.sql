-- Moxie Digital: Dormant Vessel Identity — fixes from live testing
-- (docs/moxie_digital_dormant_identity_spec.md, built in 20260913_dormant_identity.sql)
--
-- Three issues found testing both scenarios end to end:
--
-- 1. /dashboard/upgrade's "Choose a plan" bounced a past_due Full
--    account straight back to /dashboard with no way to fix anything —
--    fixed in app code (dashboard/upgrade/page.tsx), no SQL change.
-- 2. A JSX whitespace collapse produced "1 vessel isdormant" on the
--    overflow banner — fixed in app code (dashboard/page.tsx), no SQL
--    change.
-- 3. Saving the manage-fleet picker timed out. All five dormancy
--    functions below serialize on the SAME pg_advisory_xact_lock key
--    per owner (by design, to prevent two concurrent requests for one
--    account racing each other) — but with no lock_timeout set, a
--    request that has to wait for another one holding that lock waits
--    indefinitely instead of failing with a clear, retryable error. This
--    migration adds a 5-second lock_timeout to all five, so contention
--    surfaces as a real Postgres error (caught by the calling server
--    action, shown to the user) instead of a hang — same "errors must
--    surface, never hang" principle already applied to the Basic-to-Full
--    upgrade fix earlier in this build.

CREATE OR REPLACE FUNCTION set_vessels_lapsed(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'lapsed', dormant_since = now()
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed'
      );
END;
$$;

CREATE OR REPLACE FUNCTION clear_vessels_lapsed(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  UPDATE vessels
    SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
    WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed';

  UPDATE users SET past_due_since = NULL WHERE id = p_owner_id;

  PERFORM reconcile_vessel_overflow(p_owner_id);
END;
$$;

CREATE OR REPLACE FUNCTION reconcile_vessel_overflow(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier TEXT;
  owner_email TEXT;
  limit_for_tier INTEGER;
  active_count INTEGER;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, email INTO owner_tier, owner_email FROM users WHERE id = p_owner_id;
  IF is_admin_email(owner_email) THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN;
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count <= limit_for_tier THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN;
  END IF;

  UPDATE users
    SET downgrade_grace_until = now() + INTERVAL '14 days'
    WHERE id = p_owner_id AND downgrade_grace_until IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION apply_overflow_fallback(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier TEXT;
  owner_email TEXT;
  limit_for_tier INTEGER;
  grace_until TIMESTAMPTZ;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, downgrade_grace_until, email INTO owner_tier, grace_until, owner_email FROM users WHERE id = p_owner_id;

  IF is_admin_email(owner_email) THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN;
  END IF;

  IF grace_until IS NULL OR grace_until > now() THEN
    RETURN;
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY updated_at DESC) AS rn
    FROM vessels
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active'
  )
  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'locked', dormant_since = now()
    WHERE id IN (SELECT id FROM ranked WHERE rn > limit_for_tier);

  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'locked'
      );

  UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
END;
$$;

CREATE OR REPLACE FUNCTION choose_active_vessels(p_owner_id UUID, p_vessel_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier TEXT;
  owner_email TEXT;
  limit_for_tier INTEGER;
  chosen_count INTEGER;
  valid_count INTEGER;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, email INTO owner_tier, owner_email FROM users WHERE id = p_owner_id;
  limit_for_tier := vessel_limit_for_tier(owner_tier);

  chosen_count := coalesce(array_length(p_vessel_ids, 1), 0);
  IF chosen_count > limit_for_tier AND NOT is_admin_email(owner_email) THEN
    RAISE EXCEPTION 'Chose % vessels, but the current plan allows %.', chosen_count, limit_for_tier;
  END IF;

  SELECT count(*) INTO valid_count
    FROM vessels
    WHERE id = ANY(p_vessel_ids) AND owner_id = p_owner_id AND qr_status = 'active';
  IF valid_count <> chosen_count THEN
    RAISE EXCEPTION 'One or more chosen vessels do not belong to this account.';
  END IF;

  UPDATE vessels
    SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
    WHERE id = ANY(p_vessel_ids) AND owner_id = p_owner_id;

  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'locked', dormant_since = now()
    WHERE owner_id = p_owner_id
      AND qr_status = 'active'
      AND lifecycle_status = 'active'
      AND NOT (id = ANY(p_vessel_ids));

  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'locked'
      );

  UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
END;
$$;
