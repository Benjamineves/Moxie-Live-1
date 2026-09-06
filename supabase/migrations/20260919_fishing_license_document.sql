-- Fishing License as a fourth document slot.
--
-- Structurally a sibling of the boater card — a personal credential the
-- OPERATOR holds, not equipment bolted to the boat — with one difference
-- that drives the whole shape of this: a CA fishing license normally
-- expires, and a boater card never does.
--
-- CDFW sells both. An annual sport fishing license runs 365 days from
-- the date of purchase (NOT to a calendar year-end, and NOT to any fixed
-- date), while the Lifetime Sport Fishing License packages genuinely
-- never expire. So this needs both an expiry date AND a lifetime flag,
-- and the expiry must come from whatever date the owner reads off their
-- own license. Nothing in the app derives, defaults, or infers that date
-- — see lib/document-expiry.ts, which only ever parses what it is given.
--
-- fishing_license_expiry is an OWNER field, not vessel-intrinsic: it
-- describes the person, so it saves directly through
-- updateVesselOwnerFields with no confirm step, exactly like ins_expiry.
-- reg_expiry is the intrinsic one and stays confirm-gated.

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_fishing_license_url      TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_fishing_license_filename TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS fishing_license_expiry       DATE;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS fishing_license_lifetime     BOOLEAN;

COMMENT ON COLUMN vessels.doc_fishing_license_url IS
  'Storage path of the uploaded fishing license, in the private vessel-docs bucket. Personal operator credential, like doc_boater_card_url — cleared on ownership transfer, never inherited by the buyer.';
COMMENT ON COLUMN vessels.doc_fishing_license_filename IS
  'Original filename as uploaded, for display only. See doc_registration_filename.';
COMMENT ON COLUMN vessels.fishing_license_expiry IS
  'Expiry date exactly as printed on the owner''s license. CA annual sport fishing licenses run 365 days from purchase, so this is NOT derivable from a calendar year or any fixed date and must never be defaulted — it is only ever the date the owner entered. NULL when unknown, or when fishing_license_lifetime is true.';
COMMENT ON COLUMN vessels.fishing_license_lifetime IS
  'True for a CDFW Lifetime Sport Fishing License, which genuinely never expires. When true the UI shows no expiry status and asks for no date, mirroring how ca_boater_card documents a credential with no expiry at all.';

-- ────────────────────────────────────────────────────────────────────────────
-- complete_ownership_transfer -- re-declared to clear the new columns.
--
-- This is the one non-additive statement in this migration, so: the body
-- below was copied verbatim out of 20260908_ownership_transfer.sql and
-- has exactly ONE change, the doc_fishing_license_url /
-- fishing_license_expiry / fishing_license_lifetime line added to the
-- UPDATE. Everything else — the idempotency guard, the vessel_snapshot
-- capture, the share revocation, the payment bookkeeping — is unchanged.
--
-- 20260918 deliberately did NOT re-declare this function to clear a
-- cosmetic filename column, and that reasoning still stands for
-- doc_fishing_license_filename, which is unreachable once its url column
-- is NULL. It does not stand for these three. A fishing license belongs
-- to the person, not the hull; leaving it attached would show a buyer
-- holding the seller's license, with an expiry date that means nothing
-- to them. Same reason doc_boater_card_url and ca_boater_card are
-- already cleared on the line directly above the new one.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION complete_ownership_transfer(p_transfer_id UUID, p_stripe_payment_intent_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  v RECORD;
  snap JSONB;
  buyer_name TEXT;
BEGIN
  SELECT * INTO t FROM ownership_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF t.status = 'completed' THEN
    RETURN;  -- already processed by an earlier webhook delivery
  END IF;
  IF t.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Transfer is not awaiting payment (status: %)', t.status;
  END IF;

  SELECT * INTO v FROM vessels WHERE id = t.vessel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel % not found', t.vessel_id;
  END IF;

  snap := to_jsonb(v) - 'owner_id';

  SELECT full_name INTO buyer_name FROM users WHERE id = t.buyer_id;

  -- ownership_history: close the seller's tenure, open the buyer's.
  -- This is the first time this table (build spec §11's extensibility
  -- hook) is ever actually written to. If no open row exists for this
  -- vessel (true for every vessel today -- nothing has populated this
  -- table before now), fall back to the vessel's own created_at as the
  -- seller's ownership_start, since that's the best available proxy
  -- for "when they became the owner of this MXE ID."
  IF EXISTS (SELECT 1 FROM ownership_history WHERE vessel_id = t.vessel_id AND ownership_end IS NULL) THEN
    UPDATE ownership_history
      SET ownership_end = CURRENT_DATE,
          transfer_type = CASE WHEN t.initiated_via = 'escrow' THEN 'escrow_sale' ELSE 'private_sale' END
      WHERE vessel_id = t.vessel_id AND ownership_end IS NULL;
  ELSE
    INSERT INTO ownership_history (vessel_id, owner_name, ownership_start, ownership_end, transfer_type)
    VALUES (
      t.vessel_id, COALESCE(v.owner_name, 'Unknown'), v.created_at::date, CURRENT_DATE,
      CASE WHEN t.initiated_via = 'escrow' THEN 'escrow_sale' ELSE 'private_sale' END
    );
  END IF;

  INSERT INTO ownership_history (vessel_id, owner_name, ownership_start, ownership_end, transfer_type)
  VALUES (t.vessel_id, COALESCE(buyer_name, 'New owner'), CURRENT_DATE, NULL, NULL);

  -- Owner-specific fields cleared on the live row -- not because the
  -- data is discarded (it's already safe in snap above), but because
  -- leaving them in place would mean the buyer's own future edits
  -- overwrite the seller's historical values in place, corrupting the
  -- frozen record snap was just built to protect. Storage/marina and
  -- registration fields reset too (confirmed decisions): stale data
  -- that looks current is worse than a blank field prompting the new
  -- owner to fill it in.
  UPDATE vessels SET
    owner_id = t.buyer_id,
    owner_name = NULL, owner_phone = NULL, owner_email = NULL, preferred_contact = NULL,
    emg_name = NULL, emg_phone = NULL, emg_relationship = NULL,
    ins_carrier = NULL, ins_broker = NULL, ins_policy = NULL, ins_expiry = NULL, ins_liability = NULL,
    doc_insurance_url = NULL,
    doc_boater_card_url = NULL, ca_boater_card = NULL,
    doc_fishing_license_url = NULL, fishing_license_expiry = NULL, fishing_license_lifetime = NULL,
    reg_state = NULL, reg_number = NULL, reg_expiry = NULL,
    storage_type = NULL, storage_description = NULL, storage_state = NULL, storage_city = NULL,
    marina_name = NULL, marina_city = NULL, slip_number = NULL, marina_phone = NULL,
    is_liveaboard = NULL, slip_notes = NULL,
    public_notes = NULL
  WHERE id = t.vessel_id;

  UPDATE vessel_shares SET revoked_at = now() WHERE vessel_id = t.vessel_id AND revoked_at IS NULL;

  UPDATE ownership_transfers
    SET status = 'completed', completed_at = now(), payment_status = 'paid',
        stripe_payment_intent_id = p_stripe_payment_intent_id, vessel_snapshot = snap
    WHERE id = p_transfer_id;
END;
$$;
