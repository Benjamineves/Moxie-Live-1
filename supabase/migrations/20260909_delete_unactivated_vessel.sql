-- Moxie Digital: owner-initiated hard delete for unactivated vessels.
--
-- A vessel that's been registered but never paid for (qr_status =
-- 'pending_payment') has no removal path today — decommission is
-- admin-mediated and explicitly refuses to engage with a pending
-- vessel (submitDecommissionRequest already checks qr_status ===
-- 'active'), so someone who registers, gets to checkout, and decides
-- not to proceed is stuck with a dead entry, or would have to pay just
-- to be allowed to ask for its removal. This is a genuine delete,
-- unlike decommission — nothing has been paid for and no public
-- profile has ever existed, so there's nothing worth preserving a
-- record of.
--
-- Same dependency-order deletion as reset_test_vessels.sql, scoped to
-- one vessel instead of the whole test set: deleting explicitly from
-- every referencing table regardless of which FKs happen to cascade,
-- so nothing here depends on a constraint someone would have to go
-- re-verify later.

CREATE OR REPLACE FUNCTION delete_unactivated_vessel(p_vessel_id UUID, p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
BEGIN
  -- The authoritative check. The calling server action re-checks this
  -- too (a friendlier, earlier error for the UI), and the trigger only
  -- ever renders when the vessel is already showing "needs
  -- activation" — but this is the real enforcement point, same as
  -- every other mutating function added this session
  -- (accept_ownership_transfer, reactivate_vessel, etc.) never trusts
  -- the caller and re-verifies its own precondition.
  SELECT id, owner_id, qr_status INTO v FROM vessels WHERE id = p_vessel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel % not found', p_vessel_id;
  END IF;
  IF v.owner_id <> p_owner_id THEN
    RAISE EXCEPTION 'Vessel % does not belong to owner %', p_vessel_id, p_owner_id;
  END IF;
  IF v.qr_status <> 'pending_payment' THEN
    RAISE EXCEPTION 'Vessel % is not pending activation (qr_status: %) — activated vessels must go through decommission, not deletion', p_vessel_id, v.qr_status;
  END IF;

  DELETE FROM vessel_shares WHERE vessel_id = p_vessel_id;
  DELETE FROM vessel_decommission_requests WHERE vessel_id = p_vessel_id;
  DELETE FROM vessel_identity_correction_requests WHERE vessel_id = p_vessel_id;
  DELETE FROM vessel_identity_audit_log WHERE vessel_id = p_vessel_id;
  DELETE FROM ownership_transfers WHERE vessel_id = p_vessel_id;
  DELETE FROM vessel_documents WHERE vessel_id = p_vessel_id;
  DELETE FROM qr_tokens WHERE vessel_id = p_vessel_id;
  DELETE FROM vessel_payments WHERE vessel_id = p_vessel_id;
  DELETE FROM ownership_history WHERE vessel_id = p_vessel_id;
  DELETE FROM vessels WHERE id = p_vessel_id;

  -- Deliberately nothing here touches mxe_id_seq. A DELETE on vessels
  -- has no effect on a Postgres sequence at all — they're independent
  -- objects — so the MXE ID this vessel held is simply gone,
  -- permanently, exactly as the sequence already guarantees for every
  -- vessel regardless of how it stops existing.
END;
$$;

COMMENT ON FUNCTION delete_unactivated_vessel IS
  'Owner-initiated hard delete, strictly for qr_status=pending_payment vessels. Re-verifies that precondition itself rather than trusting the caller. Storage files (photos/documents) are NOT touched here — Postgres has no access to Supabase Storage; the calling server action removes them as a separate, best-effort step after this transaction commits.';
