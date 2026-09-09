-- Stage 7c: reclaiming a badge from a checkout that was never completed.
--
-- Assignment happens at createVessel, which runs before payment (§3.1),
-- so every abandoned checkout permanently burns a printed badge off the
-- shelf. This is the recovery path for exactly that case, and only that
-- case.
--
-- WHY THIS IS NOT ID RECYCLING
--
-- §2.5 forbids returning an identity to stock because a badge bearing
-- that MXE ID may already be on a hull. That reason does not apply when
-- the vessel never activated and the badge never left the shelf: nothing
-- was posted, no customer ever held it, and the ID was never issued to
-- anyone. §6 row 5 is about reissuing an ID that has been out in the
-- world. This one never was.
--
-- The whole safety of this operation is the narrowness of that boundary,
-- which is why every precondition is checked HERE and not in the UI. The
-- admin screen shows them as ticks and crosses so an operator knows why
-- they can or cannot proceed; it is not the control.
--
-- ONE PRECONDITION FROM THE APPROVED PLAN IS DELIBERATELY ABSENT.
--
-- The plan listed "identity.shipped_at IS NULL" as the "badge never
-- shipped" check. That column does not mean that. It is written
-- batch-wide when a batch moves printed -> in_stock and records the
-- badge being shipped BY THE PRINTER to us — so it is set on every
-- identity in stock, and the check would have refused every reclaim
-- including the intended one. Verified against live data before writing
-- this.
--
-- There is no per-identity record of a badge being posted to a customer.
-- vessels.sticker_order_status is the only signal that exists, and it
-- carries that weight alone (MX007 below). Stated here rather than
-- discovered later.
--
-- WHAT THIS FUNCTION CANNOT CHECK
--
-- It cannot prove no payment succeeded. A PaymentIntent that succeeded
-- while its webhook never arrived leaves qr_status = 'pending_payment'
-- AND zero vessel_payments rows — indistinguishable, in Postgres, from a
-- checkout nobody ever completed. Only Stripe knows. The admin action
-- searches Stripe by metadata.mxe_id before calling this and refuses on
-- any non-terminal or successful intent, and refuses if that lookup
-- fails at all — an unreachable API is not evidence of no payment. That
-- gate lives in the action because this function cannot make network
-- calls; it is additional to these checks, never a substitute.

-- ---------------------------------------------------------------------
-- The log.
--
-- §4.1 requires re-binding to be an explicit, logged admin action; this
-- is adjacent and gets the same treatment. Deliberately NO foreign key
-- to vessels: the vessel is being deleted in the same transaction, so a
-- referencing log row is impossible by construction. The identity FK is
-- kept, because identities are never deleted.
--
-- This is the only record that a given MXE ID was ever attached to
-- someone and then detached. Everything else about that vessel is gone.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.badge_reclaim_log (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  mxe_id            TEXT NOT NULL,
  badge_identity_id UUID REFERENCES public.badge_identities(id),
  badge_token       TEXT,
  vessel_created_at TIMESTAMPTZ,
  vessel_name       TEXT,
  owner_name        TEXT,
  owner_email       TEXT,
  reason            TEXT NOT NULL,
  reclaimed_by      TEXT NOT NULL,
  reclaimed_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.badge_reclaim_log IS
  'One row per badge identity returned to stock from an unactivated vessel. No FK to vessels: the vessel is deleted in the same transaction. This is the only surviving record of that vessel.';

-- Read by admins through the service-role client, which bypasses RLS.
-- No policy is added on purpose — same posture as badge_identities.
ALTER TABLE public.badge_reclaim_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS badge_reclaim_log_mxe_id_idx ON public.badge_reclaim_log (mxe_id);
CREATE INDEX IF NOT EXISTS badge_reclaim_log_reclaimed_at_idx ON public.badge_reclaim_log (reclaimed_at DESC);

-- ---------------------------------------------------------------------
-- delete_unactivated_vessel
--
-- Custom SQLSTATEs so every refusal is separately testable. A blanket
-- refusal cannot be demonstrated, and a demonstration is the only way to
-- know a destructive guard actually guards.
--
--   MX001 vessel does not exist
--   MX002 qr_status is not pending_payment
--   MX003 the vessel has been activated at some point
--   MX004 lifecycle_status is not active
--   MX005 rows in another table reference this vessel
--   MX006 the badge link is missing or inconsistent
--   MX007 a badge has already been ordered or shipped for this vessel
--   MX008 no reason given
--   MX009 no admin identity given
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_unactivated_vessel(
  p_vessel_id   UUID,
  p_reason      TEXT,
  p_admin_email TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v            vessels%ROWTYPE;
  v_identity   badge_identities%ROWTYPE;
  v_blocker    TEXT;
  v_count      BIGINT;
  v_table      TEXT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'delete_unactivated_vessel: a reason is required' USING ERRCODE = 'MX008';
  END IF;

  IF p_admin_email IS NULL OR btrim(p_admin_email) = '' THEN
    RAISE EXCEPTION 'delete_unactivated_vessel: the acting admin must be identified' USING ERRCODE = 'MX009';
  END IF;

  -- Locked for the whole transaction so nothing can activate underneath
  -- the checks below and be deleted a moment later.
  SELECT * INTO v FROM vessels WHERE id = p_vessel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'delete_unactivated_vessel: vessel % does not exist', p_vessel_id USING ERRCODE = 'MX001';
  END IF;

  IF v.qr_status IS DISTINCT FROM 'pending_payment' THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: % is qr_status=% — only a vessel still awaiting payment can be reclaimed',
      v.mxe_id, coalesce(v.qr_status, 'null')
      USING ERRCODE = 'MX002';
  END IF;

  -- The history check, and the reason qr_status alone is not enough.
  -- qr_generated_at is written once, the moment a vessel first goes
  -- active, and never cleared — so it still reads as "this was alive"
  -- for a vessel whose status has since moved on. A lapsed or
  -- decommissioned boat was somebody's boat.
  IF v.qr_generated_at IS NOT NULL THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: % was activated at % — it has been a live vessel and is not reclaimable',
      v.mxe_id, v.qr_generated_at
      USING ERRCODE = 'MX003';
  END IF;

  IF v.lifecycle_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: % is lifecycle_status=% — decommissioned and dormant vessels have a history',
      v.mxe_id, coalesce(v.lifecycle_status, 'null')
      USING ERRCODE = 'MX004';
  END IF;

  -- A badge that has been picked, packed or posted is out of our hands,
  -- and this is the ONLY signal that says so — see the note at the top
  -- about shipped_at.
  IF coalesce(v.sticker_order_status, 'not_ordered') <> 'not_ordered' THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: % has sticker_order_status=% — a badge has already been ordered for it',
      v.mxe_id, v.sticker_order_status
      USING ERRCODE = 'MX007';
  END IF;

  -- Every table that references vessels, except badge_identities, which
  -- is the link we expect and check separately.
  --
  -- These REFUSE rather than cascade. Two of them (vessel_payments,
  -- ownership_history) are declared ON DELETE CASCADE for other reasons,
  -- and relying on that here would mean this operation could silently
  -- destroy a payment record. A row in any of these means something
  -- happened to this boat, and something having happened is exactly what
  -- disqualifies it.
  FOREACH v_table IN ARRAY ARRAY[
    'vessel_payments',
    'ownership_history',
    'vessel_shares',
    'vessel_identity_correction_requests',
    'vessel_identity_audit_log',
    'vessel_decommission_requests',
    'ownership_transfers',
    'owner_notifications'
  ] LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE vessel_id = $1', v_table)
      INTO v_count USING p_vessel_id;
    IF v_count > 0 THEN
      v_blocker := coalesce(v_blocker || ', ', '') || v_table || '=' || v_count;
    END IF;
  END LOOP;

  IF v_blocker IS NOT NULL THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: % is referenced by % — something has happened to this vessel',
      v.mxe_id, v_blocker
      USING ERRCODE = 'MX005';
  END IF;

  -- The badge link, checked in BOTH directions so a half-written
  -- assignment cannot be reclaimed into an inconsistent state.
  IF v.badge_identity_id IS NULL THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: % has no assigned badge identity — there is nothing to reclaim',
      v.mxe_id
      USING ERRCODE = 'MX006';
  END IF;

  SELECT * INTO v_identity FROM badge_identities WHERE id = v.badge_identity_id FOR UPDATE;
  IF NOT FOUND OR v_identity.status <> 'assigned' OR v_identity.vessel_id IS DISTINCT FROM v.id THEN
    RAISE EXCEPTION
      'delete_unactivated_vessel: the badge link for % is inconsistent — identity status=%, vessel_id=%',
      v.mxe_id, coalesce(v_identity.status, 'missing'), coalesce(v_identity.vessel_id::TEXT, 'null')
      USING ERRCODE = 'MX006';
  END IF;

  -- Logged BEFORE the delete, inside the same transaction. If anything
  -- below fails the log row goes with it, so the log can never claim a
  -- reclaim that did not happen.
  INSERT INTO badge_reclaim_log (
    mxe_id, badge_identity_id, badge_token, vessel_created_at,
    vessel_name, owner_name, owner_email, reason, reclaimed_by
  ) VALUES (
    v.mxe_id, v_identity.id, v_identity.token, v.created_at,
    v.vessel_name, v.owner_name, v.owner_email, btrim(p_reason), btrim(p_admin_email)
  );

  -- Identity first: its vessel_id FK would otherwise block the delete.
  -- in_stock with a null vessel_id satisfies
  -- badge_identities_assigned_has_vessel, which only constrains
  -- status = 'assigned'.
  UPDATE badge_identities
     SET status      = 'in_stock',
         vessel_id   = NULL,
         assigned_at = NULL
   WHERE id = v_identity.id;

  DELETE FROM vessels WHERE id = v.id;

  RETURN jsonb_build_object(
    'mxe_id',            v.mxe_id,
    'badge_identity_id', v_identity.id,
    'returned_to_stock', true,
    -- Returned so the caller can clean up Storage. Those objects cannot
    -- be removed inside this transaction — a Storage delete is an
    -- external side effect that cannot join a Postgres one — and they
    -- are the customer's registration and insurance documents, so
    -- leaving them behind after deleting their vessel is a retention
    -- problem, not merely orphaned bytes. All four document slots, not
    -- just the two collected at intake.
    'photo_url',         v.photo_url,
    'doc_paths',         jsonb_build_array(
                           v.doc_registration_url,
                           v.doc_insurance_url,
                           v.doc_boater_card_url,
                           v.doc_fishing_license_url
                         )
  );
END;
$$;

-- Same lockdown as every other inventory function (20260923, 20260925,
-- 20260926). This one deletes customer data, so it is service_role only
-- and reached through an admin action that re-checks ADMIN_EMAILS.
REVOKE EXECUTE ON FUNCTION public.delete_unactivated_vessel(UUID, TEXT, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.delete_unactivated_vessel(UUID, TEXT, TEXT)
  TO service_role;
