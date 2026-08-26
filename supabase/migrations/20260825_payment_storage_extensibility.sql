-- Moxie Digital: payment/QR gating + storage_type (build spec §3), plus
-- ownership-transfer extensibility hooks (build spec §11). Also backfills
-- the two real founder vessels and adds one non-marina test vessel.

-- ────────────────────────────────────────────────────────────────────────────
-- vessels: storage_type (build spec §3 — patch now folded into the baseline)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS storage_type TEXT DEFAULT 'marina';       -- 'marina' | 'trailer' | 'home' | 'yard' | 'mooring' | 'other'
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS storage_description TEXT;                 -- e.g. "Trailer at home, Walnut Creek CA" — populated when storage_type != 'marina'

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
-- Seed: one vessel intentionally left at the qr_status='pending_payment'
-- default — a permanent fixture for testing the payment gate once P0-C
-- lands: the public "not yet active" response, the qr.pdf endpoint erroring,
-- and the scan route (?scan=1) failing gracefully instead of rendering a
-- normal profile. Marina storage (the non-marina case is already covered by
-- MXE-00003 above). DO NOT activate this row — a data fix here would
-- destroy the one fixture that exercises the un-activated state, and
-- qr_status is meant to be flipped only by a real payment webhook anyway.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO vessels (
  id, owner_id, marina_id, mxe_id,
  vessel_name, make, model, year, length_ft, draft_ft, vessel_type, public_notes, is_public,
  storage_type,
  slip_number, marina_phone, is_liveaboard, slip_notes,
  owner_name, owner_phone, owner_email, preferred_contact,
  hin, reg_state, reg_number
) VALUES (
  '00000000-0000-0000-0000-000000001004',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000101',
  'MXE-00004',
  'Wanderer', 'Catalina', '275 Sport', 2022, 27.5, 4.5, 'sail',
  'Test fixture for the pending-payment gate (build spec §5 / §9-D). Intentionally never activated — do not flip qr_status on this row.',
  true,
  'marina',
  '12', '(510) 555-0111', false, 'Standard utilities.',
  'Ben Eves', '312-465-0672', 'ben@moxieyachting.com', 'phone',
  'CAT27522H789', 'CA', 'CF 8765432'
)
ON CONFLICT (mxe_id) DO NOTHING;
