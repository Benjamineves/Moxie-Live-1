-- Clear the seller's document filenames on ownership transfer.
--
-- complete_ownership_transfer already nulls doc_insurance_url,
-- doc_boater_card_url and doc_fishing_license_url. Their _filename
-- counterparts were left behind, so a buyer's row keeps the seller's
-- original filenames — often their name. Invisible today, because the UI
-- only reads a filename for a slot that has a URL, but it is one person's
-- personal data sitting on another's record. Same principle that clears
-- the boater card.
--
-- SOURCE OF THIS BODY. It is the deployed definition — the body
-- 20261005_service_records.sql installed, which I confirmed is live by
-- querying the database (service_records exists and holds real rows,
-- including one whose updated_at has moved past its logged_at, so the
-- table, the trigger and the edit path are all in service). I could not
-- run pg_get_functiondef myself; if you want belt and braces, run the
-- query in the report before pasting this.
--
-- The ONLY difference from that deployed body is the three
-- doc_*_filename = NULL clauses, marked inline. RETURNS void is kept, so
-- CREATE OR REPLACE needs no DROP and therefore no grant reset.
--
-- EXISTING ROWS: none change. This alters no data — it only changes what
-- a future transfer clears. Rows already transferred keep whatever
-- filenames they inherited; there are no completed transfers today.
--
-- DEPLOY ORDER: either, and independent of any app code. Nothing reads
-- these columns except through a slot that has a URL.

BEGIN;

CREATE OR REPLACE FUNCTION public.complete_ownership_transfer(p_transfer_id uuid, p_stripe_payment_intent_id text)
RETURNS void
LANGUAGE plpgsql
AS $function$
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
    -- ── THE ONLY CHANGE IN 20261006 ──────────────────────────────────
    -- The URLs were already cleared; their filenames were not, so a
    -- buyer's row kept strings like "Dave Smith insurance 2026.pdf".
    -- Invisible — the UI only reads a filename for a slot that has a URL —
    -- but it is the seller's personal data on someone else's record.
    -- Same principle as the boater card itself.
    --
    -- doc_registration_filename is NOT here: doc_registration_url is not
    -- nulled either, because the registration document carries to the
    -- buyer (FAQ #selling). Clearing its filename would leave a surviving
    -- document with no name to display it by.
    doc_insurance_url = NULL, doc_insurance_filename = NULL,
    doc_boater_card_url = NULL, doc_boater_card_filename = NULL, ca_boater_card = NULL,
    doc_fishing_license_url = NULL, doc_fishing_license_filename = NULL,
    fishing_license_expiry = NULL, fishing_license_lifetime = NULL,
    reg_state = NULL, reg_number = NULL, reg_expiry = NULL,
    storage_type = NULL, storage_description = NULL, storage_state = NULL, storage_city = NULL,
    marina_name = NULL, marina_city = NULL, slip_number = NULL, marina_phone = NULL,
    is_liveaboard = NULL, slip_notes = NULL,
    public_notes = NULL
  WHERE id = t.vessel_id;

  -- Deployed by 20261005: the service history carries, its attachments
  -- do not.
  UPDATE service_records
     SET file_path = NULL, file_name = NULL, file_size_bytes = NULL
   WHERE vessel_id = t.vessel_id AND file_path IS NOT NULL;

  UPDATE vessel_shares SET revoked_at = now() WHERE vessel_id = t.vessel_id AND revoked_at IS NULL;

  UPDATE ownership_transfers
    SET status = 'completed', completed_at = now(), payment_status = 'paid',
        stripe_payment_intent_id = p_stripe_payment_intent_id, vessel_snapshot = snap
    WHERE id = p_transfer_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard: roll back unless the function is still the one shape we expect.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  overloads INTEGER;
BEGIN
  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one complete_ownership_transfer, found %. Rolling back.', overloads;
  END IF;

  IF (SELECT pg_get_function_result(p.oid)
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer') <> 'void' THEN
    RAISE EXCEPTION 'complete_ownership_transfer no longer returns void. Rolling back.';
  END IF;

  IF has_function_privilege('anon', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'complete_ownership_transfer is executable by anon or authenticated. Rolling back.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute complete_ownership_transfer. Rolling back.';
  END IF;

  -- The statement this migration exists to add.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer'
       AND p.prosrc LIKE '%doc_insurance_filename = NULL%'
       AND p.prosrc LIKE '%doc_boater_card_filename = NULL%'
       AND p.prosrc LIKE '%doc_fishing_license_filename = NULL%'
  ) THEN
    RAISE EXCEPTION 'The filename clauses are not in the installed body. Rolling back.';
  END IF;

  -- And the statements it must not have dropped.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer'
       AND p.prosrc LIKE '%ownership_history%'
       AND p.prosrc LIKE '%service_records%'
       AND p.prosrc LIKE '%RETURN;%'
  ) THEN
    RAISE EXCEPTION 'The installed body lost ownership_history, service_records or the completed-status return. Rolling back.';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
