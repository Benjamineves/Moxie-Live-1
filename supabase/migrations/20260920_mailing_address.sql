-- Mailing address for badge fulfillment.
--
-- Per-vessel, not per-account, matching the existing Contact block
-- (owner_name / owner_phone / owner_email) rather than living on users.
-- A badge ships for a specific vessel, and an owner with two boats can
-- legitimately want them sent to two different places — a home address
-- and a marina office, say. Same shape means the same edit path:
-- ContactEdit.tsx through updateVesselOwnerFields, no confirm step,
-- since none of this describes the hull.
--
-- Collected twice, into one set of columns: Stripe's AddressElement at
-- badge checkout (required before the charge, so nothing is ever paid
-- for with nowhere to ship it), and ContactEdit any time after. Neither
-- is a special case of the other — they write the same five columns.
--
-- All nullable, and NOT backfilled: no vessel predating this has an
-- address recorded anywhere to recover one from, and every future
-- signup collects it at payment. admin/stickers renders a missing
-- address as an explicit gap rather than a blank cell.

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS mailing_line1 TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS mailing_line2 TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS mailing_city  TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS mailing_state TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS mailing_zip   TEXT;

COMMENT ON COLUMN vessels.mailing_line1 IS
  'Street address the physical badge ships to. Collected by Stripe AddressElement at badge checkout and editable afterwards in ContactEdit. Per-vessel by design: one owner, two boats, potentially two destinations.';
COMMENT ON COLUMN vessels.mailing_line2 IS
  'Apartment / suite / slip office line. Optional even when the rest of the address is present.';
COMMENT ON COLUMN vessels.mailing_city IS 'City the badge ships to. See mailing_line1.';
COMMENT ON COLUMN vessels.mailing_state IS
  'Two-letter state code. Deliberately NOT validated through normalize_state_code the way storage_state is — storage_state feeds geographic reporting, this is a postal field and only ever has to be printable on a label.';
COMMENT ON COLUMN vessels.mailing_zip IS 'Postal code the badge ships to. See mailing_line1.';

-- ────────────────────────────────────────────────────────────────────────────
-- complete_ownership_transfer -- re-declared to clear the new columns.
--
-- The seller's home address must not survive a sale. It sits with
-- owner_name / owner_phone / owner_email, which this function already
-- clears on the line directly above the new one, and for exactly the
-- same reason: it identifies the person, not the hull.
--
-- The body below was extracted verbatim from
-- 20260919_fishing_license_document.sql -- NOT from 20260908, which
-- defines an older version of this function. Rebuilding from 20260908
-- would silently revert 20260919's fishing-license clearing the moment
-- this migration ran after it. Exactly ONE line is added here.
--
-- Run order therefore matters: 20260919 before 20260920.
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
    mailing_line1 = NULL, mailing_line2 = NULL, mailing_city = NULL, mailing_state = NULL, mailing_zip = NULL,
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
