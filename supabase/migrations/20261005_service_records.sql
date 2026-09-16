-- Service records — the vessel's maintenance history, Full Access only.
-- docs/moxie_roadmap.md, "Service records and miscellaneous documents".
--
-- A separate collection, NOT more document slots. The four primary
-- documents (registration, insurance, boater card, fishing licence) are
-- identity papers with renewal dates and stay exactly as they are; nothing
-- in this file touches them, their expiry logic, or the tier document
-- limit.
--
--   service_records   one row per service, hanging off the VESSEL
--
-- WHY logged_at IS ENFORCED HERE AND NOT IN THE APP
--
-- The credibility of a seller-authored history rests entirely on one
-- thing: the owner can choose what an entry says, but not when they said
-- it. A history logged steadily over six seasons reads differently from
-- one where all 22 entries appeared the week before listing, and a buyer
-- can see which they are looking at. That only holds if logged_at cannot
-- be set or moved by anyone — so it is DEFAULT now(), and a BEFORE UPDATE
-- trigger forces OLD.logged_at back onto every update for every role,
-- service_role included. A check in a server action would be a check one
-- caller makes; this is the same reasoning that locks HIN and year
-- (CLAUDE.md, "Enforcement lives in the function or a shared helper").
--
-- service_date is the opposite and is freely editable: it is a claim about
-- the world, and people do log things late.
--
-- TRANSFER. Entries carry to the buyer with the vessel; attached files do
-- not. complete_ownership_transfer is re-created below with one added
-- statement that nulls file_path/file_name/file_size_bytes on this
-- vessel's rows, leaving the entries and both dates intact. The files stay
-- in the seller's storage path (vessel-docs/<sellerUserId>/…), which is
-- already how the four primary documents behave after a transfer, and the
-- rows keep file_was_attached = true so the buyer can still see that an
-- entry HAD evidence and ask for it directly.
--
-- EXISTING ROWS: none change. One new table; complete_ownership_transfer
-- gains exactly one statement, on top of the body read out of the LIVE
-- database — see the note above the function.
--
-- DEPLOY ORDER: EITHER, but prefer running this BEFORE the deploy. The app
-- tolerates the table being absent (PGRST205/42P01 read as "no records
-- yet"), so a deploy-first order shows owners an empty history rather than
-- an error. Running it first simply means the feature works on arrival.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- service_records
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.service_records (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id         UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,

  -- Who entered it. Kept for attribution after a transfer: the buyer sees
  -- that an entry predates them. ON DELETE SET NULL so removing a user
  -- never removes the boat's history.
  logged_by         UUID REFERENCES public.users(id) ON DELETE SET NULL,

  -- Owner-entered, freely editable: a claim about when the work happened.
  service_date      DATE NOT NULL,

  -- Fixed list, not free text. Grouping is the whole display and free text
  -- would produce "Engine", "engine", "Engine service" as three groups.
  category          TEXT NOT NULL CHECK (category IN (
                      'engine',
                      'drivetrain',
                      'hull_and_bottom',
                      'electrical',
                      'plumbing_and_tanks',
                      'rigging_and_sails',
                      'safety_equipment',
                      'electronics',
                      'canvas_and_upholstery',
                      'haul_out_and_survey',
                      'other'
                    )),

  description       TEXT NOT NULL CHECK (btrim(description) <> '' AND length(description) <= 2000),
  -- Who did the work. Optional, and free text on purpose: a yard name is
  -- not an entity we hold.
  provider          TEXT CHECK (provider IS NULL OR length(provider) <= 200),

  -- The optional attached file. Nulled on transfer; file_was_attached is
  -- not, so the buyer keeps "this entry had a document" without the bytes.
  file_path         TEXT,
  file_name         TEXT,
  file_size_bytes   BIGINT CHECK (file_size_bytes IS NULL OR file_size_bytes >= 0),
  file_was_attached BOOLEAN NOT NULL DEFAULT false,

  -- System-set and immutable. See the header.
  logged_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A file_path implies a name; neither implies the other alone.
  CONSTRAINT service_records_file_pair CHECK (
    (file_path IS NULL AND file_name IS NULL) OR (file_path IS NOT NULL AND file_name IS NOT NULL)
  ),
  -- A row that has a path must be marked as having had one.
  CONSTRAINT service_records_attached_flag CHECK (file_path IS NULL OR file_was_attached)
);

-- The history reads newest first within a vessel; the grouping is done in
-- the app from one ordered fetch rather than a query per category.
CREATE INDEX IF NOT EXISTS service_records_vessel_date
  ON public.service_records (vessel_id, service_date DESC, logged_at DESC);

COMMENT ON COLUMN public.service_records.logged_at IS
  'When Moxie recorded this entry. System-set, immutable for every role including service_role (service_records_freeze_logged_at). This is what makes a seller-authored history credible: the owner chooses what an entry says, never when they said it. Locked for the same reason HIN and year are.';
COMMENT ON COLUMN public.service_records.service_date IS
  'When the work happened, as entered by the owner. Freely editable — a claim about the world, and people log things late.';
COMMENT ON COLUMN public.service_records.file_was_attached IS
  'True once a file has ever been attached, and never cleared. Survives the transfer that nulls file_path, so a buyer sees which entries had evidence and can ask the seller for those specifically.';

-- ─────────────────────────────────────────────────────────────────────────
-- logged_at is immutable — enforced, not asked for politely
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.service_records_freeze_logged_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Silently restore rather than raise: an UPDATE that happens to carry the
  -- whole row (a PostgREST patch, say) is not an attack, and failing it
  -- would make ordinary edits brittle. What matters is that the value
  -- cannot move, whoever asks.
  NEW.logged_at := OLD.logged_at;
  -- file_was_attached is one-way: once true, always true.
  NEW.file_was_attached := OLD.file_was_attached OR NEW.file_was_attached;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS service_records_freeze ON public.service_records;
CREATE TRIGGER service_records_freeze
  BEFORE UPDATE ON public.service_records
  FOR EACH ROW EXECUTE FUNCTION public.service_records_freeze_logged_at();

-- ─────────────────────────────────────────────────────────────────────────
-- Access: service role only, same as every other table the app writes
-- through server actions. RLS on with no policies closes anon and
-- authenticated; the grants close the rest.
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.service_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.service_records FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.service_records TO service_role;

REVOKE EXECUTE ON FUNCTION public.service_records_freeze_logged_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.service_records_freeze_logged_at() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- complete_ownership_transfer — entries carry, files do not
--
-- THIS BODY IS THE LIVE DEFINITION, read out of the database, with ONE
-- statement added (marked below). It is NOT rebuilt from an earlier
-- migration file: the newest file defining this function differs from what
-- is deployed — it returns JSONB where the live one returns void, and the
-- live one carries a completed-status early return and the whole
-- ownership_history block that no migration file contains. Replacing the
-- live body with a file's version would have silently dropped both.
--
-- RETURNS void is kept, so CREATE OR REPLACE works with no DROP and
-- therefore no grant reset (CLAUDE.md: a dropped function is recreated
-- executable by PUBLIC).
-- ─────────────────────────────────────────────────────────────────────────
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
    doc_insurance_url = NULL,
    doc_boater_card_url = NULL, ca_boater_card = NULL,
    doc_fishing_license_url = NULL, fishing_license_expiry = NULL, fishing_license_lifetime = NULL,
    reg_state = NULL, reg_number = NULL, reg_expiry = NULL,
    storage_type = NULL, storage_description = NULL, storage_state = NULL, storage_city = NULL,
    marina_name = NULL, marina_city = NULL, slip_number = NULL, marina_phone = NULL,
    is_liveaboard = NULL, slip_notes = NULL,
    public_notes = NULL
  WHERE id = t.vessel_id;

  -- ── THE ONLY ADDED STATEMENT (20261005) ──────────────────────────────
  -- The service history carries; its attachments do not. The rows stay,
  -- both dates stay, file_was_attached stays true -- so the buyer sees the
  -- cadence and sees which entries had documents, and asks the seller for
  -- those directly. The bytes stay in the seller's storage path, which is
  -- exactly what already happens to the primary documents above.
  UPDATE service_records
     SET file_path = NULL, file_name = NULL, file_size_bytes = NULL
   WHERE vessel_id = t.vessel_id AND file_path IS NOT NULL;
  -- ─────────────────────────────────────────────────────────────────────

  UPDATE vessel_shares SET revoked_at = now() WHERE vessel_id = t.vessel_id AND revoked_at IS NULL;

  UPDATE ownership_transfers
    SET status = 'completed', completed_at = now(), payment_status = 'paid',
        stripe_payment_intent_id = p_stripe_payment_intent_id, vessel_snapshot = snap
    WHERE id = p_transfer_id;
END;
$function$;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard: roll the whole file back unless every claim above is true.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  overloads INTEGER;
  probe_id  UUID;
  frozen    TIMESTAMPTZ;
  moved     TIMESTAMPTZ;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'service_records') THEN
    RAISE EXCEPTION 'service_records was not created. Rolling back.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'service_records' AND relnamespace = 'public'::regnamespace AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'RLS is not enabled on service_records. Rolling back.';
  END IF;

  IF has_table_privilege('anon', 'public.service_records', 'SELECT')
     OR has_table_privilege('authenticated', 'public.service_records', 'SELECT') THEN
    RAISE EXCEPTION 'anon or authenticated can read service_records. Rolling back.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.service_records', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot INSERT into service_records. Rolling back.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.service_records'::regclass
       AND tgname = 'service_records_freeze' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The logged_at freeze trigger is missing. Rolling back.';
  END IF;

  -- Demonstrate the freeze rather than trust the trigger's existence:
  -- insert a probe with a vessel_id of NULL? No — vessel_id is NOT NULL,
  -- so borrow any vessel if one exists, and skip the proof on an empty
  -- database rather than inventing a vessel.
  SELECT id INTO probe_id FROM vessels LIMIT 1;
  IF probe_id IS NOT NULL THEN
    INSERT INTO service_records (vessel_id, service_date, category, description, logged_at)
    VALUES (probe_id, CURRENT_DATE, 'other', '[migration probe]', TIMESTAMPTZ '2001-01-01 00:00:00+00')
    RETURNING logged_at INTO frozen;

    UPDATE service_records
       SET logged_at = TIMESTAMPTZ '2030-01-01 00:00:00+00', description = '[migration probe, updated]'
     WHERE description = '[migration probe]'
    RETURNING logged_at INTO moved;

    IF moved IS DISTINCT FROM frozen THEN
      RAISE EXCEPTION 'logged_at moved on UPDATE (% -> %). Rolling back.', frozen, moved;
    END IF;

    DELETE FROM service_records WHERE description = '[migration probe, updated]';
  END IF;

  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'service_records_freeze_logged_at';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one service_records_freeze_logged_at, found %. Rolling back.', overloads;
  END IF;
  IF has_function_privilege('anon', 'public.service_records_freeze_logged_at()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.service_records_freeze_logged_at()', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_records_freeze_logged_at is executable by anon or authenticated. Rolling back.';
  END IF;

  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'complete_ownership_transfer';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one complete_ownership_transfer, found %. Rolling back.', overloads;
  END IF;
  IF has_function_privilege('anon', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'complete_ownership_transfer is executable by anon or authenticated. Rolling back.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.complete_ownership_transfer(UUID, TEXT)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute complete_ownership_transfer. Rolling back.';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
