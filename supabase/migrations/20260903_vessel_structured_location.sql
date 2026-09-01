-- Moxie Digital: structured storage location at the source.
--
-- Replaces the parse-and-guess approach with two structured columns
-- captured at registration, so downstream geographic tracking reads a
-- real field instead of inferring one from free text.
--
-- BACKWARD COMPATIBLE. Both columns are additive and nullable, so the
-- currently-deployed code keeps working unchanged after this runs (it
-- simply never writes them). Safe to run BEFORE the matching deploy
-- goes live — which is the recommended order, since the new intake form
-- errors on insert until these columns exist.
--
-- ────────────────────────────────────────────────────────────────────────────
-- Why nullable, when the form requires a state
--
-- The ~10 existing test vessels predate this change and have no value to
-- backfill (their location lives in free text like "Home" or "neighbor",
-- which is exactly the problem being fixed). A NOT NULL constraint would
-- reject them. The requirement is enforced at the form and again
-- server-side in createVessel (validated against the 50-state + DC list
-- in web/src/lib/us-states.ts) — that's where the guarantee lives for
-- every vessel registered from here on.
--
-- Once the test vessels are wiped and recreated through the new form,
-- adding `ALTER TABLE vessels ALTER COLUMN storage_state SET NOT NULL`
-- becomes safe if we want the database to enforce it too.
-- ────────────────────────────────────────────────────────────────────────────

-- Two-letter USPS state code ('CA', 'FL', 'WA'). Structured, not free
-- text. This is the authoritative state field the multi-state geographic
-- dashboard will read, replacing the current use of reg_state as a proxy
-- (reg_state is where the boat is REGISTERED, not where it's stored — a
-- CA-registered boat can be trailered anywhere).
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS storage_state TEXT;

-- City name only, no state suffix ('Oakland', not 'Oakland, CA').
-- Distinct from marina_city, which mixes both into one free-text string
-- and is only ever populated for marina/mooring vessels. storage_city is
-- captured for EVERY storage type — trailer/home/yard/other included,
-- which previously had no city field at all and could only be described
-- in the storage_description blob.
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS storage_city TEXT;

-- Supports the dashboard's per-state grouping.
CREATE INDEX IF NOT EXISTS idx_vessels_storage_state ON vessels(storage_state);

COMMENT ON COLUMN vessels.storage_state IS
  'Two-letter USPS code for where the vessel is STORED (not registered). Structured; validated server-side at intake. Authoritative state field for geographic reporting.';
COMMENT ON COLUMN vessels.storage_city IS
  'City name only, no state suffix. Captured for every storage type, unlike the marina-only marina_city.';
