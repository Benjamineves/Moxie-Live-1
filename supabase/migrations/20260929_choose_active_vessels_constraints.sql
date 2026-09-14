-- choose_active_vessels: enforce what its comment claims.
--
-- The previous definition (20260914_dormancy_fixes.sql) said it
-- "only ever" restores locked vessels. It did not check. The restore was
--
--   UPDATE vessels SET lifecycle_status = 'active', dormant_cause = NULL, ...
--     WHERE id = ANY(p_vessel_ids) AND owner_id = p_owner_id;
--
-- and the only thing standing between that UPDATE and a lapsed or
-- decommissioned vessel was the manage-fleet PAGE's query, which decides
-- what to offer. The server action passes whatever ids it is sent. A page
-- restricting the choices it shows is not authorization.
--
-- Three holes, all closed here:
--
-- 1. A LAPSED vessel could be restored by sending its id directly —
--    reactivation without resubscribing.
--
-- 2. A DECOMMISSIONED vessel could be restored the same way, skipping the
--    admin step (reactivate_vessel). Note this is NOT closed by checking
--    dormant_cause alone: apply_vessel_decommission never clears
--    dormant_cause, and requestVesselDecommission does not refuse a
--    dormant vessel, so a vessel that was locked when it was
--    decommissioned carries lifecycle_status = 'decommissioned' WITH
--    dormant_cause = 'locked'. The constraint has to be on both columns.
--
-- 3. A LOCKED vessel on an account with no subscription. set_vessels_lapsed
--    only touches lifecycle_status = 'active' rows, so vessels that were
--    already locked stay dormant/locked when the subscription is cancelled.
--    Constraining to dormant/locked alone would still let a cancelled
--    account restore them — and this one was reachable through the normal
--    UI, not just a crafted request, because the manage-fleet page lists
--    locked vessels and checks no subscription status. Restoring a locked
--    vessel now requires an account entitled to active vessels.
--
-- No live data is in any of these states today (checked before writing:
-- 10 active vessels, 1 decommissioned with dormant_cause NULL, none
-- dormant), so there is nothing to repair.
--
-- ────────────────────────────────────────────────────────────────────────
-- EXECUTE GRANTS
--
-- This is CREATE OR REPLACE with the identical signature (uuid, uuid[])
-- and identical return type (void), confirmed against the live schema.
-- Replacing a function in place keeps its owner and its ACL, so the
-- lockdown from 20260923_lock_rpc_execute_grants survives without being
-- re-applied. No DROP is needed.
--
-- The real risk is the other one: if the signature written here differed
-- from the live one by so much as a parameter type, CREATE OR REPLACE
-- would not replace anything — it would create a SECOND overload, and a
-- newly created function is executable by PUBLIC. The block at the end
-- fails the whole transaction if there is more than one
-- choose_active_vessels, or if anon or authenticated can execute it.
-- The grant is also re-asserted on the exact signature, which is a no-op
-- when the ACL is already right.
-- ────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE OR REPLACE FUNCTION choose_active_vessels(p_owner_id UUID, p_vessel_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier       TEXT;
  owner_email      TEXT;
  owner_status     TEXT;
  owner_past_due   TIMESTAMPTZ;
  limit_for_tier   INTEGER;
  chosen_count     INTEGER;
  distinct_count   INTEGER;
  owned_count      INTEGER;
  eligible_count   INTEGER;
  restoring_count  INTEGER;
  entitled         BOOLEAN;
BEGIN
  SET LOCAL lock_timeout = '5s';
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, email, subscription_status, past_due_since
    INTO owner_tier, owner_email, owner_status, owner_past_due
    FROM users WHERE id = p_owner_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account % not found.', p_owner_id;
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  chosen_count := coalesce(array_length(p_vessel_ids, 1), 0);
  SELECT count(DISTINCT x) INTO distinct_count FROM unnest(p_vessel_ids) AS x;
  IF distinct_count <> chosen_count THEN
    RAISE EXCEPTION 'The same vessel was chosen more than once.';
  END IF;

  IF chosen_count > limit_for_tier AND NOT is_admin_email(owner_email) THEN
    RAISE EXCEPTION 'Chose % vessels, but the current plan allows %.', chosen_count, limit_for_tier;
  END IF;

  -- Ownership. Unchanged from the previous definition, message included.
  SELECT count(*) INTO owned_count
    FROM vessels
    WHERE id = ANY(p_vessel_ids) AND owner_id = p_owner_id AND qr_status = 'active';
  IF owned_count <> chosen_count THEN
    RAISE EXCEPTION 'One or more chosen vessels do not belong to this account.';
  END IF;

  -- Eligibility (holes 1 and 2). A chosen vessel must either already be
  -- active, or be dormant BECAUSE it is locked. Refused outright rather
  -- than silently skipped: skipping would still count the ineligible id
  -- against the plan limit and quietly leave the owner with fewer active
  -- vessels than they chose.
  SELECT count(*) INTO eligible_count
    FROM vessels
    WHERE id = ANY(p_vessel_ids)
      AND owner_id = p_owner_id
      AND qr_status = 'active'
      AND (
        lifecycle_status = 'active'
        OR (lifecycle_status = 'dormant' AND dormant_cause = 'locked')
      );
  IF eligible_count <> chosen_count THEN
    RAISE EXCEPTION USING
      ERRCODE = 'MX020',
      MESSAGE = 'One or more chosen vessels are paused because the subscription ended, or are decommissioned. Those can''t be restored here — resubscribe, or contact Moxie about a decommissioned vessel.';
  END IF;

  -- Entitlement (hole 3). Only gates a RESTORE. Choosing among vessels
  -- that are already active changes nothing about what the account is
  -- paying for, and gating it would lock out accounts that legitimately
  -- hold an active vessel with no subscription of their own — a buyer who
  -- received one by transfer is one today.
  --
  -- 'past_due' is entitled until the grace period has elapsed, mirroring
  -- apply_past_due_dormancy_if_expired exactly, including treating a NULL
  -- past_due_since as still in grace. 7 days mirrors
  -- DORMANCY.PAST_DUE_GRACE_DAYS in lib/tier-config.ts — keep in sync by
  -- hand, the same trade-off every dormancy function already makes.
  SELECT count(*) INTO restoring_count
    FROM vessels
    WHERE id = ANY(p_vessel_ids)
      AND owner_id = p_owner_id
      AND lifecycle_status = 'dormant'
      AND dormant_cause = 'locked';

  entitled := owner_status = 'active'
    OR (owner_status = 'past_due' AND (owner_past_due IS NULL OR now() < owner_past_due + INTERVAL '7 days'));

  IF restoring_count > 0 AND NOT entitled AND NOT is_admin_email(owner_email) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'MX021',
      MESSAGE = 'This account doesn''t have an active subscription, so a paused vessel can''t be made active. Resubscribe to restore it.';
  END IF;

  -- The restore itself carries the same constraint as the check above.
  -- Deliberately repeated rather than trusted from the validation: the
  -- UPDATE is the thing that grants access, and it should be correct on
  -- its own if the checks above are ever edited.
  UPDATE vessels
    SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
    WHERE id = ANY(p_vessel_ids)
      AND owner_id = p_owner_id
      AND qr_status = 'active'
      AND lifecycle_status = 'dormant'
      AND dormant_cause = 'locked';

  -- Unchanged: lock every other currently-active vessel.
  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'locked', dormant_since = now()
    WHERE owner_id = p_owner_id
      AND qr_status = 'active'
      AND lifecycle_status = 'active'
      AND NOT (id = ANY(p_vessel_ids));

  -- Unchanged: spec §3 share revocation for anything now locked.
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

-- Re-assert the 20260923 lockdown on the exact signature. A no-op when
-- the replace above kept the ACL, which it should have.
REVOKE EXECUTE ON FUNCTION public.choose_active_vessels(UUID, UUID[]) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.choose_active_vessels(UUID, UUID[]) TO service_role;

-- Fail the whole transaction rather than leave an overload or an open grant.
DO $$
DECLARE
  overloads INTEGER;
BEGIN
  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'choose_active_vessels';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one choose_active_vessels, found %. A signature mismatch created an overload — rolling back.', overloads;
  END IF;

  IF has_function_privilege('anon', 'public.choose_active_vessels(uuid, uuid[])', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.choose_active_vessels(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'choose_active_vessels is executable by anon or authenticated — rolling back.';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.choose_active_vessels(uuid, uuid[])', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role lost EXECUTE on choose_active_vessels — rolling back.';
  END IF;
END $$;

COMMIT;
