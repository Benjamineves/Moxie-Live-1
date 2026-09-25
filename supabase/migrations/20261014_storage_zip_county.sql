-- Structured storage location: a 5-digit ZIP for where the boat is kept, and
-- the county derived from it (geography Stage 1).
--
-- COLUMNS
--   vessels.storage_zip     TEXT, NULL or exactly 5 digits (CHECK). Nullable
--                           at the database so existing vessels keep working;
--                           the app requires it on registration and whenever
--                           the Storage section is saved.
--   vessels.storage_county  TEXT, derived SERVER-SIDE from the ZIP (Census
--                           2020 ZCTA-to-county file, largest land area within
--                           the vessel's storage_state). Never accepted from a
--                           client.
-- Neither is public: the scan page and share links render allow-lists
-- (filterVesselForRole, filterVesselForShare) that don't include them, and
-- since 20261010/20261013 the public key can't read vessels at all.
--
-- TRANSFER. complete_ownership_transfer clears the other storage fields on
-- the live row, so these must be cleared too — a new column left off that
-- explicit list would carry the seller's ZIP to the buyer. The body below is
-- 20261006's, copied from the file, which is the verified live definition
-- (confirmed deployed 2026-09-16; nothing since replaces it — 20261007 only
-- names it in comments; the 2026-09-25 security snapshot shows the same
-- signature, return type and settings). The ONLY difference is the
-- storage_zip/storage_county clause, marked inline. RETURNS void is
-- unchanged, so CREATE OR REPLACE keeps the grants.
--
-- EXISTING ROWS: gain two NULL columns; nothing else changes.
--
-- DEPLOY ORDER: run this BEFORE the app commit that writes storage_zip.
-- create_vessel_with_badge rejects keys that aren't columns of vessels, so
-- that code deployed first would fail every registration.

BEGIN;

ALTER TABLE public.vessels ADD COLUMN IF NOT EXISTS storage_zip TEXT;
ALTER TABLE public.vessels ADD COLUMN IF NOT EXISTS storage_county TEXT;

ALTER TABLE public.vessels DROP CONSTRAINT IF EXISTS vessels_storage_zip_format;
ALTER TABLE public.vessels ADD CONSTRAINT vessels_storage_zip_format
  CHECK (storage_zip IS NULL OR storage_zip ~ '^[0-9]{5}$');

COMMENT ON COLUMN public.vessels.storage_zip IS
  'ZIP where the vessel is kept (5 digits). Required by the app on registration and Storage saves; never public.';
COMMENT ON COLUMN public.vessels.storage_county IS
  'County derived server-side from storage_zip (Census 2020 ZCTA-county, largest land area within storage_state). Never public.';

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
    -- ── THE ONLY CHANGE IN 20261014 ──────────────────────────────────
    -- The structured storage ZIP and its derived county clear with the
    -- rest of the storage fields: where the seller kept the boat is not
    -- where the buyer keeps it. Both are in snap above.
    storage_zip = NULL, storage_county = NULL,
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

-- Guard: roll the whole file back unless the end state is exactly this.
DO $$
DECLARE
  overloads INTEGER;
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.vessels'::regclass AND attname = 'storage_zip' AND NOT attisdropped) IS DISTINCT FROM 'text'
     OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.vessels'::regclass AND attname = 'storage_county' AND NOT attisdropped) IS DISTINCT FROM 'text' THEN
    RAISE EXCEPTION 'storage_zip / storage_county missing or not text. Rolling back.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.vessels'::regclass AND conname = 'vessels_storage_zip_format') THEN
    RAISE EXCEPTION 'vessels_storage_zip_format constraint missing. Rolling back.';
  END IF;

  IF has_any_column_privilege('anon', 'public.vessels', 'SELECT')
     OR has_any_column_privilege('authenticated', 'public.vessels', 'SELECT') THEN
    RAISE EXCEPTION 'anon/authenticated can read vessels columns. Rolling back.';
  END IF;

  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one complete_ownership_transfer, found %. Rolling back.', overloads;
  END IF;

  IF pg_get_function_result('public.complete_ownership_transfer(UUID, TEXT)'::regprocedure) <> 'void' THEN
    RAISE EXCEPTION 'complete_ownership_transfer no longer returns void. Rolling back.';
  END IF;

  IF has_function_privilege('anon', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'complete_ownership_transfer is executable by anon or authenticated. Rolling back.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute complete_ownership_transfer. Rolling back.';
  END IF;

  -- The clause this migration exists to add, and what it must not have lost.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer'
       AND p.prosrc LIKE '%storage_zip = NULL, storage_county = NULL%'
       AND p.prosrc LIKE '%doc_insurance_filename = NULL%'
       AND p.prosrc LIKE '%ownership_history%'
       AND p.prosrc LIKE '%service_records%'
       AND p.prosrc LIKE '%vessel_shares%'
       AND p.prosrc LIKE '%RETURN;%'
       AND p.prosrc LIKE '%- ''owner_id''%'
  ) THEN
    RAISE EXCEPTION 'Installed body is missing the new clause or something 20261006 had. Rolling back.';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
