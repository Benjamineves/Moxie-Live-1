-- Payment and title records must outlive the vessel.
--
-- vessel_payments.vessel_id and ownership_history.vessel_id were declared
-- REFERENCES vessels(id) ON DELETE CASCADE (20260825), so deleting a vessel
-- deleted its payment records and its chain of title with it, silently, as a
-- side effect of the vessel going. A payment record is what a refund or a
-- dispute starts from; ownership_history is the chain of title a transfer
-- dispute starts from. Neither should disappear because something else was
-- deleted.
--
-- After this, Postgres refuses to delete a vessel that has either kind of
-- record. That matches what delete_unactivated_vessel already does (MX005
-- refuses when either table has rows), so no application path changes
-- behaviour — this makes the rule hold for every other delete as well,
-- including one typed into the SQL editor.
--
-- WHAT THIS DOES NOT PROTECT AGAINST
--
-- An EXPLICIT delete of the records themselves. 20260916 removed four test
-- vessels by deleting their vessel_payments rows first and the vessels
-- second — RESTRICT would not have stopped it, because by the time the
-- vessel was deleted nothing referenced it. (Stripe still holds those four
-- succeeded test-mode payments; the database records are gone.) Refusing
-- that needs the tables themselves to be append-only, which is a separate
-- decision.
--
-- WHICH TABLES, AND WHY ONLY THESE
--
-- Audited every foreign key in supabase/seed.sql and supabase/migrations.
-- Only four are ON DELETE CASCADE, all onto vessels:
--   vessel_payments   — financial. Changed here.
--   ownership_history — title / audit. Changed here.
--   vessel_documents  — upload metadata from the base schema, unused by the
--                       app. Left as is.
--   qr_tokens         — legacy token mapping from the base schema, unused by
--                       the app. Left as is.
-- Every other financial or audit table already refuses: account_payments
-- (owner_id -> users), ownership_transfers (vessel_id, seller_id, buyer_id),
-- vessel_identity_audit_log (vessel_id) and badge_reclaim_log (identity) all
-- use the default NO ACTION, which blocks the parent delete. badge_reclaim_log
-- has no vessel foreign key at all, by design.
--
-- The repository is not the database — the base schema lives in seed.sql,
-- outside the migrations. So the constraints are found in pg_constraint
-- rather than assumed by name, the change aborts unless it finds exactly the
-- two it expects, and every CASCADE foreign key still left in the public
-- schema afterwards is listed as a NOTICE so the live state can be read off
-- the output.

BEGIN;

DO $$
DECLARE
  r        RECORD;
  targets  INTEGER;
BEGIN
  SELECT count(*) INTO targets
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.vessels'::regclass
     AND c.conrelid IN ('public.vessel_payments'::regclass, 'public.ownership_history'::regclass)
     AND c.conkey = ARRAY[(
       SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'vessel_id'
     )];
  IF targets <> 2 THEN
    RAISE EXCEPTION 'Expected one vessel_id foreign key on each of vessel_payments and ownership_history, found %. Nothing changed.', targets;
  END IF;

  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, c.confdeltype
      FROM pg_constraint c
     WHERE c.contype = 'f'
       AND c.confrelid = 'public.vessels'::regclass
       AND c.conrelid IN ('public.vessel_payments'::regclass, 'public.ownership_history'::regclass)
       AND c.conkey = ARRAY[(
         SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = c.conrelid AND a.attname = 'vessel_id'
       )]
  LOOP
    RAISE NOTICE 'Replacing % on % (ON DELETE was %) with ON DELETE RESTRICT', r.conname, r.tbl, r.confdeltype;
    -- Same constraint name, so anything that reports or matches on it still does.
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT %I', r.tbl, r.conname);
    EXECUTE format(
      'ALTER TABLE %s ADD CONSTRAINT %I FOREIGN KEY (vessel_id) REFERENCES public.vessels(id) ON DELETE RESTRICT',
      r.tbl, r.conname
    );
  END LOOP;
END $$;

-- Verify, and report what is left.
DO $$
DECLARE
  r       RECORD;
  bad     INTEGER;
BEGIN
  SELECT count(*) INTO bad
    FROM pg_constraint c
   WHERE c.contype = 'f'
     AND c.confrelid = 'public.vessels'::regclass
     AND c.conrelid IN ('public.vessel_payments'::regclass, 'public.ownership_history'::regclass)
     AND c.confdeltype <> 'r';
  IF bad > 0 THEN
    RAISE EXCEPTION 'A vessel_payments or ownership_history foreign key onto vessels is still not RESTRICT. Rolling back.';
  END IF;

  FOR r IN
    SELECT c.conname, c.conrelid::regclass AS tbl, c.confrelid::regclass AS parent
      FROM pg_constraint c
      JOIN pg_namespace n ON n.oid = c.connamespace
     WHERE c.contype = 'f' AND c.confdeltype = 'c' AND n.nspname = 'public'
     ORDER BY 2, 1
  LOOP
    RAISE NOTICE 'Still ON DELETE CASCADE: %.% -> %', r.tbl, r.conname, r.parent;
  END LOOP;
END $$;

COMMIT;
