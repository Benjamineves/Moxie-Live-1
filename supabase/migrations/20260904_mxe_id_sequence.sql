-- Moxie Digital: MXE IDs become a real Postgres sequence.
--
-- MXE IDs are permanent vessel identity — they're printed on physical
-- badges and encoded in the public scan URL. Deriving them from
-- MAX(vessels.mxe_id) meant a deleted vessel's ID was silently handed
-- back out to the next registration, so a badge already in circulation
-- could come to point at a different boat. A sequence never reuses a
-- value, including after a delete.
--
-- BACKWARD COMPATIBLE. next_mxe_id() keeps the same name, signature and
-- 'MXE-00000' return format, so currently-deployed code keeps working
-- unchanged after this runs. Safe to run before the matching deploy.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Why there is no window where two vessels can take the same ID
--
-- 1. nextval() is atomic and never returns a value twice, even under
--    concurrent calls, and (deliberately) does not roll back — two
--    simultaneous registrations get different numbers by construction.
--    The old advisory lock existed to paper over a read-then-compute
--    race that a sequence simply doesn't have, so it's gone.
--
-- 2. The whole migration runs in one transaction, and Postgres DDL is
--    transactional: a concurrent call to next_mxe_id() sees either the
--    old MAX-based definition or the new sequence-based one, never a
--    half-applied mix.
--
-- 3. The sequence is positioned above every ID that currently exists
--    (see the DO block), so the first value it ever hands out cannot
--    collide with a live vessel. The unique constraint on vessels.mxe_id
--    remains as the final backstop.
--
-- 4. The JS fallback in web/src/lib/mxe-id.ts that recomputed an ID from
--    MAX(mxe_id) when the RPC failed is removed in the same change. That
--    fallback was the one remaining path that could reissue a used ID;
--    it now throws instead, because failing a registration is strictly
--    better than minting a duplicate identity.
-- ────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- STARTING VALUE — the one line to change if you want different numbering.
--
-- Set to 1001, so the first real vessel is MXE-01001.
--
-- Recommended over starting at 1. Starting at 1 is impossible to do
-- safely right now: the 10 test vessels currently occupy MXE-00001
-- through MXE-00013, so a sequence starting at 1 would collide on its
-- first call. It could only be done as a second step after the wipe —
-- and that would hand the first real customers exactly the IDs the test
-- badges were printed with, which is the reuse this migration exists to
-- prevent. Two of those test badges are already marked shipped.
--
-- The offset also stays readable forever: anything below MXE-01000 is
-- test-era, anything at MXE-01001 or above is a real vessel.
--
-- If you'd rather the real dataset start at 1 anyway, change the value
-- below to 1 and run this migration only AFTER the test-vessel wipe.
-- ────────────────────────────────────────────────────────────────────────────

CREATE SEQUENCE IF NOT EXISTS public.mxe_id_seq AS BIGINT MINVALUE 1 START WITH 1001;

DO $$
DECLARE
  desired_start CONSTANT BIGINT := 1001;
  max_existing  BIGINT;
  start_at      BIGINT;
BEGIN
  -- Highest ID currently in use, so we can guarantee we start above it
  -- regardless of what the data looks like when this actually runs.
  SELECT COALESCE(MAX(CAST(right(mxe_id, 5) AS BIGINT)), 0)
  INTO max_existing
  FROM vessels
  WHERE mxe_id ~ '^MXE-[0-9]{5}$';

  start_at := GREATEST(desired_start, max_existing + 1);

  -- is_called = false means the NEXT nextval() returns exactly start_at
  -- rather than start_at + 1.
  PERFORM setval('public.mxe_id_seq', start_at, false);

  RAISE NOTICE 'mxe_id_seq positioned at %, highest existing ID was %', start_at, max_existing;
END $$;

CREATE OR REPLACE FUNCTION public.next_mxe_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  next_num BIGINT;
BEGIN
  next_num := nextval('public.mxe_id_seq');

  -- The MXE-00000 format is fixed at five digits and is printed on
  -- physical badges. Refuse to mint a malformed ID rather than silently
  -- emitting a 6-digit one that breaks every '^MXE-[0-9]{5}$' check in
  -- the codebase. At ~99k vessels this needs a deliberate format
  -- decision, not an accident.
  IF next_num > 99999 THEN
    RAISE EXCEPTION 'mxe_id_seq exhausted the 5-digit MXE ID space (reached %)', next_num;
  END IF;

  RETURN 'MXE-' || lpad(next_num::TEXT, 5, '0');
END $$;

COMMENT ON SEQUENCE public.mxe_id_seq IS
  'Permanent MXE ID allocator. Values are never reused, including after a vessel is deleted. Gaps are expected and fine (an abandoned registration burns its reserved ID).';

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Verify after running:
--
--   SELECT last_value, is_called FROM mxe_id_seq;   -- expect 1001, false
--   SELECT next_mxe_id();                           -- expect 'MXE-01001'
--
-- NOTE: that second query CONSUMES 1001, so the first real vessel would
-- then get MXE-01002. Either skip it, or run this to put it back:
--
--   SELECT setval('mxe_id_seq', 1001, false);
-- ────────────────────────────────────────────────────────────────────────────
