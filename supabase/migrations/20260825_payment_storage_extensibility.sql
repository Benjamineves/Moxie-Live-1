-- Moxie Digital: payment/QR gating + storage_type (build spec §3), plus
-- ownership-transfer extensibility hooks (build spec §11). Enables Row Level
-- Security (with policies) on vessels, users, vessel_documents — drafted in
-- seed.sql but never turned on — plus the two new tables this migration
-- creates. Also backfills the two real founder vessels and adds three
-- distinct test fixtures: MXE-00003 (non-marina storage), MXE-00004
-- (payment gate, never active), MXE-00005 (free-text marina, the new
-- default path) — see each INSERT's own comment below for what it's
-- specifically for and not for.

-- ────────────────────────────────────────────────────────────────────────────
-- vessels: storage_type (build spec §3 — patch now folded into the baseline)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS storage_type TEXT DEFAULT 'marina';       -- 'marina' | 'trailer' | 'home' | 'yard' | 'mooring' | 'other'
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS storage_description TEXT;                 -- e.g. "Trailer at home, Walnut Creek CA" — populated when storage_type != 'marina'

-- ────────────────────────────────────────────────────────────────────────────
-- vessels: marina_name / marina_city as free text (self-serve intake)
--
-- The self-serve intake form (dashboard/new) collects marina name/city as
-- free text, not a pick from the `marinas` table — the funnel needs to work
-- for any marina, not just the handful pre-seeded there, and there's no
-- marina-creation flow to resolve free text into a new marinas row. So these
-- are plain text columns on vessels, populated directly from intake for
-- storage_type IN ('marina', 'mooring').
--
-- marina_id (existing column, unchanged) stays NULL for every vessel created
-- through this intake flow — it is reserved for when the marina role
-- reactivates and a real marina-creation/matching flow exists to link these
-- free-text values (or replace them) with an actual marinas row. Application
-- code should read marina_name/marina_city first and fall back to the
-- marina_id join only for vessels seeded before this column existed
-- (MXE-00001/MXE-00002), which have marina_id set but no free-text value.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS marina_name TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS marina_city TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- vessels: payment/QR gating (build spec §3, §4, §5)
--
-- qr_status is PERMANENT once flipped from 'pending_payment' to 'active' by
-- the setup_fee payment webhook. No code path may ever revert it back —
-- this includes a subscription lapsing to past_due/canceled (build spec §4):
-- that only downgrades users.subscription_tier to 'basic' and must never
-- touch qr_status. There is no DB trigger enforcing this one-way transition;
-- the Stripe webhook handler (and nothing else) is the only thing that
-- should ever write to this column, and only pending_payment -> active.
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS qr_status TEXT DEFAULT 'pending_payment';       -- 'pending_payment' | 'active' — PERMANENT once 'active', see comment above
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS qr_generated_at TIMESTAMPTZ;                     -- set once, the moment qr_status first flips to 'active'
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS sticker_order_status TEXT DEFAULT 'not_ordered'; -- 'not_ordered' | 'ordered' | 'printed' | 'shipped'

-- ────────────────────────────────────────────────────────────────────────────
-- vessels: claim_status (build spec §11 — extensibility hook, cheap now)
-- Every vessel created through the current intake flow sets this to 'claimed'
-- immediately (owner exists at creation time) — zero effect on the current
-- build. Only matters once pre-provisioned/unclaimed vessel stubs exist
-- (marina bulk-deployment, deferred per build spec §0/§7).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS claim_status TEXT DEFAULT 'claimed';   -- 'unclaimed' | 'claimed'

-- ────────────────────────────────────────────────────────────────────────────
-- users: Stripe identity + subscription (build spec §3, §4)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';   -- 'none' | 'active' | 'past_due' | 'canceled'
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier TEXT DEFAULT 'basic';    -- 'basic' | 'full'

-- ────────────────────────────────────────────────────────────────────────────
-- vessel_payments (build spec §3)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vessel_payments (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id                 UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  payment_type              TEXT NOT NULL,                     -- 'setup_fee' | 'subscription'
  stripe_payment_intent_id  TEXT,
  amount_cents              INTEGER,
  status                    TEXT NOT NULL DEFAULT 'pending',   -- 'pending' | 'paid' | 'failed' | 'refunded'
  paid_at                   TIMESTAMPTZ
);

-- ────────────────────────────────────────────────────────────────────────────
-- ownership_history (build spec §11 — extensibility hook, cheap now)
-- Not populated by anything in the current build. Having the table exist now
-- means a future ownership-transfer feature append-only-inserts into it
-- rather than needing a schema migration alongside that feature's launch.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ownership_history (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id         UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  owner_name        TEXT NOT NULL,      -- denormalized, per patent §[0067]
  ownership_start   DATE NOT NULL,
  ownership_end     DATE,               -- NULL for current owner
  transfer_type     TEXT,               -- 'initial_claim' | 'private_sale' | 'escrow_sale' | 'broker_sale' | 'gift' | 'estate' | 'other'
  notes             TEXT,
  created_at        TIMESTAMPTZ DEFAULT now()
);

-- ────────────────────────────────────────────────────────────────────────────
-- Row Level Security
--
-- seed.sql drafted RLS policies for vessels/vessel_documents/users but left
-- them entirely commented out (see its "RLS POLICIES" section), and no
-- migration since has enabled them. On the live project this almost
-- certainly means those three tables — plus the two new tables above — are
-- readable and writable by anyone holding the anon key. Fixing all five
-- here rather than leaving it for later.
--
-- Every ALTER ... ENABLE ROW LEVEL SECURITY below is safe to run whether RLS
-- was already on or off. Every policy uses DROP POLICY IF EXISTS first, so
-- this whole block is safe to re-run.
--
-- Design note: this app's client-side writes to vessels/users/vessel_payments
-- /ownership_history/vessel_documents all go through the service-role client
-- (createSupabaseServiceClient in actions.ts, dashboard pages, mxe-id.ts),
-- which uses Postgres's service_role and bypasses RLS entirely by design.
-- So none of the policies below need to grant INSERT/UPDATE/DELETE to the
-- anon or authenticated roles — there is no legitimate client-side write
-- path today, and none of these policies open one. The one exception is the
-- public SELECT on vessels: the public scan/profile page fetches the full
-- row through the anon key (field-level filtering happens in application
-- code afterward, in filterVesselForRole), so anon SELECT on vessels can't
-- be removed without breaking the core product.
-- ────────────────────────────────────────────────────────────────────────────

-- vessels — public can read active/public rows; every seeded vessel today
-- has is_public=true, so this preserves current behavior exactly. No
-- client-side write policy: creation and edits happen via the service role.
ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read active vessels" ON vessels;
CREATE POLICY "Public read active vessels" ON vessels
  FOR SELECT USING (is_public = true);

-- users — no legitimate public or cross-user read need (nothing in the app
-- publicly displays users.email/phone; the public-facing owner_email/
-- owner_phone fields live denormalized on vessels instead). Every current
-- users read/write goes through the service role. This self-read policy is
-- forward-looking hygiene, not something the current app relies on.
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own row" ON users;
CREATE POLICY "Users read own row" ON users
  FOR SELECT USING (auth.uid() = id);

-- vessel_documents — nothing in the current app reads or writes this table
-- (document uploads go to Supabase Storage with the resulting URL stored
-- directly on vessels.doc_registration_url/doc_insurance_url/photo_url, not
-- through this table). Lock it down entirely from anon; give owners
-- forward-looking read access for whenever it does get wired up.
ALTER TABLE vessel_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own vessel documents" ON vessel_documents;
CREATE POLICY "Owners read own vessel documents" ON vessel_documents
  FOR SELECT USING (
    vessel_id IN (SELECT id FROM vessels WHERE owner_id = auth.uid())
  );

-- vessel_payments — owners can see their own payment history; no
-- client-side INSERT/UPDATE at all. Only the Stripe webhook handler
-- (service role) ever writes here, per build spec §4/§14.
ALTER TABLE vessel_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own vessel payments" ON vessel_payments;
CREATE POLICY "Owners read own vessel payments" ON vessel_payments
  FOR SELECT USING (
    vessel_id IN (SELECT id FROM vessels WHERE owner_id = auth.uid())
  );

-- ownership_history — owners can see their own vessel's history; append-only
-- by access control (no policy grants any client-side write, so the only
-- way a row is ever created is the service role choosing to INSERT one —
-- nothing enforces "no UPDATE/DELETE" beyond that same absence of policy).
ALTER TABLE ownership_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own ownership history" ON ownership_history;
CREATE POLICY "Owners read own ownership history" ON ownership_history
  FOR SELECT USING (
    vessel_id IN (SELECT id FROM vessels WHERE owner_id = auth.uid())
  );

-- ────────────────────────────────────────────────────────────────────────────
-- Backfill: MXE-00001 (Discovery One) and MXE-00002 (Polaris) are real
-- founder vessels seeded before qr_status/payment gating existed — not
-- funnel signups. They must not sit in 'pending_payment'. One-time data
-- correction; application code should never do this outside a real
-- payment webhook (see comment on qr_status above).
-- ────────────────────────────────────────────────────────────────────────────

UPDATE vessels
SET qr_status = 'active',
    qr_generated_at = now(),
    sticker_order_status = 'shipped'
WHERE mxe_id IN ('MXE-00001', 'MXE-00002');

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: one non-marina test vessel (storage_type='trailer', marina_id NULL)
-- so the non-marina rendering path has something to test against — every
-- previously-seeded vessel was marina-assigned. Set qr_status='active' so
-- it's usable to test rendering immediately, independent of when P0-C
-- payment gating actually lands in application code.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO vessels (
  id, owner_id, marina_id, mxe_id,
  vessel_name, make, model, year, length_ft, draft_ft, vessel_type, public_notes, is_public,
  storage_type, storage_description,
  owner_name, owner_phone, owner_email, preferred_contact,
  hin, reg_state, reg_number,
  qr_status, qr_generated_at
) VALUES (
  '00000000-0000-0000-0000-000000001003',
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'MXE-00003',
  'Sea Otter', 'Boston Whaler', '170 Montauk', 2019, 17.0, 1.2, 'power',
  'Test fixture for non-marina storage rendering (build spec §3 / §9-D). 2019 Boston Whaler 170 Montauk, trailer-stored.',
  true,
  'trailer', 'Trailer at home, Walnut Creek CA',
  'Ben Eves', '312-465-0672', 'ben@moxieyachting.com', 'phone',
  'BW17019H456', 'CA', 'CF 7654321',
  'active', now()
)
ON CONFLICT (mxe_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: one vessel intentionally, explicitly left at qr_status='pending_payment'
-- — a permanent fixture for testing the payment gate once P0-C lands: the
-- public "not yet active" response, the qr.pdf endpoint erroring, and the
-- scan route (?scan=1) failing gracefully instead of rendering a normal
-- profile. This is the ONLY thing this row is for — do not repurpose it as
-- an example of any other path (marina vs. non-marina storage, free-text
-- vs. legacy marina_id, etc.); use MXE-00003/MXE-00005 for those instead.
-- qr_status/qr_generated_at/sticker_order_status are spelled out explicitly
-- below rather than left to the column defaults, so this fixture's meaning
-- can't silently break if those defaults ever change. DO NOT activate this
-- row — qr_status is meant to be flipped only by a real payment webhook.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO vessels (
  id, owner_id, marina_id, mxe_id,
  vessel_name, make, model, year, length_ft, draft_ft, vessel_type, public_notes, is_public,
  storage_type, marina_name, marina_city,
  slip_number, marina_phone, is_liveaboard, slip_notes,
  owner_name, owner_phone, owner_email, preferred_contact,
  hin, reg_state, reg_number,
  qr_status, qr_generated_at, sticker_order_status
) VALUES (
  '00000000-0000-0000-0000-000000001004',
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'MXE-00004',
  'Wanderer', 'Catalina', '275 Sport', 2022, 27.5, 4.5, 'sail',
  'Test fixture for the pending-payment gate (build spec §5 / §9-D). Intentionally never activated — do not flip qr_status on this row.',
  true,
  'marina', 'Emery Cove Marina', 'Emeryville, CA',
  '12', '(510) 555-0111', false, 'Standard utilities.',
  'Ben Eves', '312-465-0672', 'ben@moxieyachting.com', 'phone',
  'CAT27522H789', 'CA', 'CF 8765432',
  'pending_payment', NULL, 'not_ordered'
)
ON CONFLICT (mxe_id) DO NOTHING;

-- ────────────────────────────────────────────────────────────────────────────
-- Seed: the free-text marina example — active, storage_type='marina', with
-- marina_name/marina_city populated as plain text and marina_id NULL. This
-- is what the self-serve intake flow actually produces for a marina-stored
-- vessel (see the marina_name/marina_city column comment above): distinct
-- from MXE-00001/MXE-00002, which predate those columns and still resolve
-- their marina display through the legacy marina_id join.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO vessels (
  id, owner_id, marina_id, mxe_id,
  vessel_name, make, model, year, length_ft, draft_ft, vessel_type, public_notes, is_public,
  storage_type, marina_name, marina_city,
  slip_number, marina_phone, is_liveaboard, slip_notes,
  owner_name, owner_phone, owner_email, preferred_contact,
  hin, reg_state, reg_number,
  qr_status, qr_generated_at
) VALUES (
  '00000000-0000-0000-0000-000000001005',
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'MXE-00005',
  'Second Wind', 'Jeanneau', 'Sun Odyssey 349', 2020, 34.5, 5.9, 'sail',
  'Test fixture for the free-text marina path (build spec §3 addendum / §9-D). Marina name/city are plain text, not a marinas-table join.',
  true,
  'marina', 'Brickyard Cove Marina', 'Point Richmond, CA',
  '47', '(510) 555-0199', false, 'Standard utilities. Weekend sailor.',
  'Ben Eves', '312-465-0672', 'ben@moxieyachting.com', 'phone',
  'JEA34920H901', 'CA', 'CF 9876543',
  'active', now()
)
ON CONFLICT (mxe_id) DO NOTHING;
