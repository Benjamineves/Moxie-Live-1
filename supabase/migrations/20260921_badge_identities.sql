-- Moxie Digital: pre-minted badge inventory.
--
-- Schema only — stage 1 of docs/moxie_digital_badge_provisioning_spec.md
-- (§2.3). No application code reads or writes these tables yet, and
-- nothing about signup, payment, or vessel creation changes. Purely
-- additive: every statement below either creates a new object or adds a
-- nullable column, so this is safe to run before the matching deploy.
--
-- WHY A SEPARATE TABLE rather than pre-created `vessels` rows (§2.1):
-- unsold inventory in `vessels` would count against a customer's
-- vessel cap, inflate the admin dashboard totals, and swamp the
-- geographic breakdown with rows that have no storage data. Keeping
-- inventory outside `vessels` makes it invisible to every existing
-- query by construction, which is also how "only qr_status='active'
-- consumes a slot" stays true for free.
--
-- STATUS VOCABULARY (§2.2): badge_identities.status covers the physical
-- object up to the moment of assignment and stops there. 'active' and
-- 'dormant' are NOT repeated here — they already exist on vessels
-- (qr_status / lifecycle_status) and this table deliberately has no
-- opinion about them. One handoff point, no overlapping state machines.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- badge_print_batches
--
-- Created BEFORE badge_identities because that table references this one.
-- (§2.3's illustrative DDL lists them the other way round; that ordering
-- would not execute. No semantic change.)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badge_print_batches (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- UNIQUE is load-bearing, not tidiness: it IS the double-submission
  -- guard for the mint operation (§5.0.1). The batch row is inserted
  -- before any MXE ID is allocated, so a double-clicked or retried mint
  -- fails here having consumed nothing. §2.3's DDL omitted the
  -- constraint while §5.0.1 requires it; §5.0.1 wins, because without
  -- it the guard does not exist.
  label               TEXT NOT NULL UNIQUE,

  -- Identity count and physical badge count are different numbers
  -- (§1.6). Batch 1 is 100 identities / 200 badges. printed_count is
  -- GENERATED rather than passed in: it is strictly derived, and a
  -- stored copy of a derived number is a thing that can drift from the
  -- number it was derived from. The spec asks for both values stored;
  -- this stores both and makes disagreement impossible.
  minted_count        INTEGER  NOT NULL CHECK (minted_count > 0),
  copies_per_identity SMALLINT NOT NULL DEFAULT 2 CHECK (copies_per_identity > 0),
  printed_count       INTEGER  GENERATED ALWAYS AS (minted_count * copies_per_identity) STORED,

  -- Density of record for this batch. Every identity in a batch encodes
  -- a URL of identical length (tokens are fixed-length, §1.4), so the QR
  -- version is one fact about the whole batch rather than an average —
  -- see §5.0.5. Computable at mint time from a probe URL, before any
  -- token exists, which is what lets this be NOT NULL.
  qr_version          SMALLINT NOT NULL CHECK (qr_version BETWEEN 1 AND 40),

  sheet_pdf_path      TEXT,          -- N-up export (§5.3) — not built, blocked on supplier
  minted_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_to_printer_at  TIMESTAMPTZ,
  received_at         TIMESTAMPTZ,
  notes               TEXT
);

COMMENT ON TABLE public.badge_print_batches IS
  'One print run of pre-minted badge identities. See docs/moxie_digital_badge_provisioning_spec.md §5.0.';
COMMENT ON COLUMN public.badge_print_batches.label IS
  'Human label, e.g. "2026-10 run 1". UNIQUE is the double-submission guard for the mint operation (spec §5.0.1) — not decoration.';
COMMENT ON COLUMN public.badge_print_batches.minted_count IS
  'Number of IDENTITIES minted. Not the number of physical badges — see printed_count and spec §1.6.';
COMMENT ON COLUMN public.badge_print_batches.printed_count IS
  'Number of PHYSICAL BADGES. Generated as minted_count * copies_per_identity so it cannot drift from its inputs.';

-- ────────────────────────────────────────────────────────────────────────────
-- badge_identities
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.badge_identities (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- From next_mxe_id(). Never reused, including after void — the
  -- sequence guarantees it (20260904_mxe_id_sequence.sql) and spec §6
  -- row 5 depends on it.
  mxe_id         TEXT NOT NULL UNIQUE CHECK (mxe_id ~ '^MXE-[0-9]{5}$'),

  -- 9-char Crockford Base32, canonical uppercase (§1.4). Crockford
  -- excludes I, L, O and U to kill transcription ambiguity; the class
  -- below is 0-9 plus A-Z minus exactly those four. The CHECK is what
  -- makes stage 2's generator verifiable at the database rather than
  -- only in tests.
  token          TEXT NOT NULL UNIQUE CHECK (token ~ '^[0-9A-HJKMNP-TV-Z]{9}$'),

  status         TEXT NOT NULL DEFAULT 'minted'
                 CHECK (status IN ('minted', 'printed', 'in_stock', 'assigned', 'void')),

  print_batch_id UUID REFERENCES public.badge_print_batches(id),

  -- Rendered once per identity at mint and never regenerated (§5.1).
  -- BOTH physical copies print from this one file — the copies are
  -- impressions of one artwork, which is why there is one path here and
  -- not two. NULL means "minted but not yet rendered", which is a normal
  -- transient state during a chunked render and is exactly what the
  -- minted -> printed precondition checks for (§5.0.3).
  artwork_path   TEXT,
  qr_version     SMALLINT CHECK (qr_version BETWEEN 1 AND 40),

  -- printed_at/shipped_at are written batch-wide (§5.0.4 makes those
  -- transitions batch-level); they live per row so a later void stays
  -- traceable against when the badge was actually produced.
  printed_at     TIMESTAMPTZ,
  shipped_at     TIMESTAMPTZ,
  assigned_at    TIMESTAMPTZ,
  vessel_id      UUID REFERENCES public.vessels(id),

  -- Unbound distribution (§4.2). Modelled now so the first unbound batch
  -- does not require reprinting. The FLOW IS NOT BUILT and nothing
  -- writes these yet.
  --
  -- claim_code_hash is a hash and only ever a hash. The plaintext lives
  -- on the physical card under a scratch-off panel and nowhere else —
  -- it cannot be the QR token, because that token ends up publicly
  -- photographable on the outside of a boat.
  distribution_channel TEXT NOT NULL DEFAULT 'direct'
                       CHECK (distribution_channel IN ('direct', 'unbound')),
  claim_code_hash      TEXT,
  claim_code_issued_at TIMESTAMPTZ,
  claimed_at           TIMESTAMPTZ,
  claimed_by_user_id   UUID REFERENCES auth.users(id),

  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  voided_at      TIMESTAMPTZ,
  void_reason    TEXT,

  -- Lifecycle invariants, enforced rather than merely documented.
  -- 'assigned' is terminal for this table and always has a vessel;
  -- 'void' always records when. Both are spec semantics (§2.2, §5.0.3),
  -- promoted to constraints so a bug cannot produce a half-assigned row
  -- that the assignment query might later reconsider.
  CONSTRAINT badge_identities_assigned_has_vessel
    CHECK (status <> 'assigned' OR (vessel_id IS NOT NULL AND assigned_at IS NOT NULL)),
  CONSTRAINT badge_identities_void_has_timestamp
    CHECK (status <> 'void' OR voided_at IS NOT NULL)
);

COMMENT ON TABLE public.badge_identities IS
  'Pre-minted badge inventory: one row per MXE ID, independent of whether a vessel exists yet. Status stops at ''assigned'' — active/dormant live on vessels. See docs/moxie_digital_badge_provisioning_spec.md §2.';
COMMENT ON COLUMN public.badge_identities.token IS
  '9-char Crockford Base32, canonical uppercase. Encoded in the badge QR as /s/<token> (spec §1.4). NOT a secret: it ends up publicly visible on a hull, so it must never be used to authorise claiming.';
COMMENT ON COLUMN public.badge_identities.artwork_path IS
  'Supabase Storage path of the rendered badge, written once at mint and never regenerated (spec §5.1). NULL means not yet rendered; a batch cannot advance to ''printed'' while any row in it is NULL (spec §5.0.3).';
COMMENT ON COLUMN public.badge_identities.claim_code_hash IS
  'Hash only. The plaintext exists solely on the physical card and is never stored. Unbound distribution (spec §4.2) — modelled, not built.';
COMMENT ON COLUMN public.badge_identities.claimed_by_user_id IS
  'Who ORIGINALLY claimed this badge. After an ownership transfer this is history, not the current owner — never read it as "the owner" (spec §2.5).';

-- ────────────────────────────────────────────────────────────────────────────
-- Indexes
-- ────────────────────────────────────────────────────────────────────────────

-- Drives the assignment query (§3.1), which is
--   WHERE status = 'in_stock' ORDER BY mxe_id LIMIT 1 FOR UPDATE SKIP LOCKED
-- Partial, because that query is the only reason to scan by mxe_id and it
-- never looks at any other status. Ordering by mxe_id gives FIFO stock
-- consumption, so physical shelves are worked front to back.
CREATE INDEX IF NOT EXISTS badge_identities_in_stock_idx
  ON public.badge_identities (mxe_id)
  WHERE status = 'in_stock';

-- Case-insensitive token lookup for /s/<token> (§1.7). The CHECK above
-- already forces canonical uppercase, so this is belt-and-braces against
-- a scanner or client that lowercases the path before we see it.
CREATE UNIQUE INDEX IF NOT EXISTS badge_identities_token_lower_idx
  ON public.badge_identities (lower(token));

-- The chunked render (§5.0.5) repeatedly asks for "this batch's rows that
-- still have no artwork", and the printed-precondition (§5.0.3) asks
-- whether any remain. Partial so it stays small and empties as the batch
-- completes.
CREATE INDEX IF NOT EXISTS badge_identities_pending_artwork_idx
  ON public.badge_identities (print_batch_id)
  WHERE artwork_path IS NULL;

CREATE INDEX IF NOT EXISTS badge_identities_batch_idx
  ON public.badge_identities (print_batch_id);

-- ────────────────────────────────────────────────────────────────────────────
-- vessels.badge_identity_id
--
-- Nullable, and stays null for every vessel that predates this plus any
-- created through the mint-on-demand fallback (§3.2). vessels.mxe_id is
-- unchanged and is still the value every existing query reads — the ID is
-- duplicated onto the vessel at assignment rather than joined through, so
-- no existing query changes.
--
-- This and badge_identities.vessel_id reference each other. That is
-- deliberate and safe: both are nullable, and both are set in the same
-- transaction at assignment (§3.1).
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.vessels
  ADD COLUMN IF NOT EXISTS badge_identity_id UUID UNIQUE REFERENCES public.badge_identities(id);

COMMENT ON COLUMN public.vessels.badge_identity_id IS
  'The pre-minted badge this vessel was assigned at signup. NULL for vessels predating badge inventory, and for the mint-on-demand fallback when stock is exhausted (spec §3.2) — a NULL here means "print this one individually".';

-- ────────────────────────────────────────────────────────────────────────────
-- RLS
--
-- Enabled with no policies, matching every other admin-only table in this
-- schema (vessel_decommission_requests, vessel_identity_correction_requests).
-- All access is through the service-role client behind requireAdmin();
-- there is no owner-facing or anonymous read path to grant.
--
-- NOTE for stage 5: /s/<token> resolves tokens for unauthenticated
-- scanners, and will do so through the service-role client server-side,
-- returning only what the public page already shows. It must not be
-- turned into an anon SELECT policy on this table — that would expose
-- unsold inventory to enumeration.
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.badge_print_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.badge_identities    ENABLE ROW LEVEL SECURITY;

COMMIT;

-- ────────────────────────────────────────────────────────────────────────────
-- Verify after running:
--
--   SELECT column_name, data_type, is_nullable, is_generated
--     FROM information_schema.columns
--    WHERE table_name = 'badge_identities' ORDER BY ordinal_position;
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'vessels' AND column_name = 'badge_identity_id';
--
--   -- expect 0 rows in both; nothing writes these until stage 3
--   SELECT count(*) FROM badge_identities;
--   SELECT count(*) FROM badge_print_batches;
-- ────────────────────────────────────────────────────────────────────────────
