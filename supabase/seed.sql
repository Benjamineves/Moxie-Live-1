-- ============================================================================
-- MOXIE PLATFORM — DATABASE SEED v1
-- ============================================================================
-- 
-- Purpose:  Creates all tables and inserts seed data for the Moxie v1 MVP.
--           Run this against a fresh Supabase PostgreSQL instance.
--
-- Schema:   Reconciles the tech brief (5 tables) and technical handoff v1
--           (expanded field set) into one canonical schema. The handoff v1
--           field-to-role visibility map is the authoritative source for
--           which fields exist and who can see them.
--
-- Usage:    psql -h <supabase-host> -U postgres -d postgres -f seed.sql
--           Or paste into the Supabase SQL Editor.
--
-- Notes for coding agents:
--   - UUIDs are deterministic for dev/staging stability. Generate real UUIDs in production.
--   - All [PLACEHOLDER] values are demo data from prototypes. Real values TBD.
--   - RLS policies are included but commented out — enable after testing.
--   - Storage bucket creation is NOT in this file (use Supabase dashboard or API).
--   - Run `validate_seed.sql` (companion file) after seeding to verify integrity.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 1: marinas
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS marinas (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  city        TEXT,
  state       TEXT DEFAULT 'CA',
  region      TEXT,                    -- e.g. "SF Bay — East Bay", "SF Bay — Marin"
  phone       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO marinas (id, name, city, state, region, phone) VALUES
  ('00000000-0000-0000-0000-000000000100', 'Portobello Marina',    'Oakland',    'CA', 'SF Bay — East Bay', '(510) 555-0110'),
  ('00000000-0000-0000-0000-000000000101', 'Emery Cove Marina',    'Emeryville', 'CA', 'SF Bay — East Bay', NULL),
  ('00000000-0000-0000-0000-000000000102', 'Clipper Yacht Harbor',  'Sausalito',  'CA', 'SF Bay — Marin',    NULL);


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 2: users
-- ────────────────────────────────────────────────────────────────────────────
-- Extends the tech brief "owners" table to support all four roles from the
-- technical handoff: owner, marina_operator, coastguard, admin.

CREATE TYPE user_role AS ENUM ('owner', 'marina_operator', 'coastguard', 'admin');

CREATE TABLE IF NOT EXISTS users (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email                  TEXT UNIQUE NOT NULL,
  phone                  TEXT,
  full_name              TEXT NOT NULL,
  role                   user_role NOT NULL DEFAULT 'owner',
  marina_id              UUID REFERENCES marinas(id),  -- set if marina_operator
  preferred_contact      TEXT,                         -- 'phone' | 'text' | 'email'
  emergency_name         TEXT,
  emergency_phone        TEXT,
  emergency_relationship TEXT,
  created_at             TIMESTAMPTZ DEFAULT now(),
  last_login             TIMESTAMPTZ
);

INSERT INTO users (id, email, phone, full_name, role, marina_id, preferred_contact) VALUES
  ('00000000-0000-0000-0000-000000000001', 'ben@moxieyachting.com',       '312-465-0672', 'Ben Eves',                'admin',           NULL,                                        'phone'),
  ('00000000-0000-0000-0000-000000000010', 'demo-marina@moxieyachting.com', NULL,           'Emery Cove Demo Operator', 'marina_operator', '00000000-0000-0000-0000-000000000101',       NULL);


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 3: vessels (core table)
-- ────────────────────────────────────────────────────────────────────────────
-- The technical handoff v1 field-to-role map is the canonical reference for
-- which fields exist here. Every field in that map has a column below.

CREATE TABLE IF NOT EXISTS vessels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id        UUID NOT NULL REFERENCES users(id),
  marina_id       UUID REFERENCES marinas(id),
  mxe_id          TEXT UNIQUE NOT NULL,               -- MXE-00001 format (or future random)

  -- Public fields (visible to all roles)
  vessel_name     TEXT NOT NULL,
  make            TEXT NOT NULL,
  model           TEXT NOT NULL,
  year            INTEGER NOT NULL,
  length_ft       DECIMAL,
  draft_ft        DECIMAL,
  vessel_type     TEXT,                                -- 'power' | 'sail' | 'pwc'
  photo_url       TEXT,
  public_notes    TEXT,
  is_public       BOOLEAN DEFAULT true,

  -- Owner + Marina fields
  slip_number     TEXT,
  marina_phone    TEXT,
  is_liveaboard   BOOLEAN DEFAULT false,
  slip_notes      TEXT,

  -- Owner + Marina + CG fields (contact)
  owner_name      TEXT,
  owner_phone     TEXT,
  owner_email     TEXT,
  preferred_contact TEXT,
  emg_name        TEXT,
  emg_phone       TEXT,
  emg_relationship TEXT,

  -- Owner + CG fields (insurance full detail)
  ins_carrier     TEXT,
  ins_broker      TEXT,
  ins_policy      TEXT,
  ins_expiry      DATE,
  ins_liability   TEXT,

  -- Owner + CG fields (registration full detail)
  hin             TEXT,                                -- Hull Identification Number
  uscg_doc_number TEXT,
  official_number TEXT,
  reg_state       TEXT DEFAULT 'CA',
  reg_number      TEXT,
  reg_expiry      DATE,

  -- Owner + CG fields (propulsion & safety)
  engine          TEXT,
  fuel_type       TEXT,                                -- 'gasoline' | 'diesel' | 'electric' | 'hybrid'
  max_persons     INTEGER,
  lifejackets     INTEGER,
  fire_extinguisher BOOLEAN,
  flares          BOOLEAN,
  sound_device    BOOLEAN,
  ca_boater_card  BOOLEAN,

  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER vessels_updated_at
  BEFORE UPDATE ON vessels
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();


-- Vessel 1: Discovery One (Nimbus T8) — MXE-00001
INSERT INTO vessels (
  id, owner_id, marina_id, mxe_id,
  vessel_name, make, model, year, length_ft, draft_ft, vessel_type, photo_url, public_notes, is_public,
  slip_number, is_liveaboard, slip_notes,
  owner_name, owner_phone, owner_email, preferred_contact,
  ins_carrier, ins_broker, ins_policy, ins_expiry, ins_liability,
  hin, uscg_doc_number, official_number, reg_state, reg_number, reg_expiry,
  engine, fuel_type, max_persons, lifejackets, fire_extinguisher, flares, sound_device, ca_boater_card
) VALUES (
  '00000000-0000-0000-0000-000000001001',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000100',
  'MXE-00001',
  'Discovery One', 'Nimbus', 'T8', 2023, 26.9, 2.5, 'power',
  'vessels/mxe-00001/hero.jpg',
  '2023 Nimbus T8 day cruiser. Single Mercury Verado 300HP outboard. Regularly maintained. House battery system upgraded 2024. Life jackets for 6 aboard.',
  true,
  '38', false, 'Standard utilities. Single-engine power vessel. Typically off-slip weekends.',
  'Ben Eves', '312-465-0672', 'ben@moxieyachting.com', 'phone',
  'Markel American', 'Novamar Insurance Group', 'MAR-2025-00412', '2025-12-31', '$300,000',
  'NIM12341H223', '1234567', 'CA 1234 AB', 'CA', 'CF 1234567', '2025-12-31',
  'Mercury Verado 300HP', 'gasoline', 6, 6, true, true, true, true
);

-- Vessel 2: Polaris (Beneteau Oceanis 30.1) — MXE-00002
INSERT INTO vessels (
  id, owner_id, marina_id, mxe_id,
  vessel_name, make, model, year, length_ft, vessel_type, photo_url, public_notes, is_public,
  owner_name, owner_phone, owner_email, preferred_contact,
  ins_carrier, ins_broker, ins_expiry,
  hin, reg_state,
  ca_boater_card
) VALUES (
  '00000000-0000-0000-0000-000000001002',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000102',
  'MXE-00002',
  'Polaris', 'Beneteau', 'Oceanis 30.1', 2021, 30.0, 'sail',
  'vessels/mxe-00002/hero.jpg',
  '2021 Beneteau Oceanis 30.1 sloop. In Modern Sailing charter program at Clipper Yacht Harbor, Sausalito. Available for ASA instruction and private charter. Regularly maintained by Modern Sailing fleet team.',
  true,
  'Ben Eves', '312-465-0672', 'ben@moxieyachting.com', 'phone',
  'Markel American', 'Novamar Insurance Group', '2025-12-31',
  'BEN00000B121', 'CA',
  true
);


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 4: vessel_documents
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vessel_documents (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id   UUID NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL,            -- 'registration' | 'insurance' | 'boater_card' | 'charter_agreement' | 'other'
  doc_label   TEXT,                     -- Human-readable label for UI
  file_url    TEXT,                     -- Supabase Storage path (signed URL generated on access)
  file_name   TEXT,                     -- Original filename for display
  mime_type   TEXT,                     -- 'application/pdf' | 'image/jpeg' | 'image/png'

  -- Registration-specific fields (populated when doc_type = 'registration')
  reg_number  TEXT,
  reg_state   TEXT,
  reg_expiry  DATE,

  -- Insurance-specific fields (populated when doc_type = 'insurance')
  ins_carrier TEXT,
  ins_policy  TEXT,
  ins_expiry  DATE,

  status      TEXT DEFAULT 'current',   -- 'current' | 'expiring_soon' | 'expired'
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TRIGGER vessel_documents_updated_at
  BEFORE UPDATE ON vessel_documents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Discovery One documents
INSERT INTO vessel_documents (id, vessel_id, doc_type, doc_label, file_url, file_name, reg_number, reg_state, reg_expiry, status) VALUES
  ('00000000-0000-0000-0000-000000002001', '00000000-0000-0000-0000-000000001001', 'registration', 'USCG Documentation', 'documents/mxe-00001/USCG_Documentation_2025.pdf', 'USCG_Documentation_2025.pdf', 'CF 1234567', 'CA', '2025-12-31', 'current');

INSERT INTO vessel_documents (id, vessel_id, doc_type, doc_label, file_url, file_name, ins_carrier, ins_policy, ins_expiry, status) VALUES
  ('00000000-0000-0000-0000-000000002002', '00000000-0000-0000-0000-000000001001', 'insurance', 'Marine Insurance', 'documents/mxe-00001/Markel_Insurance_Card_2025.pdf', 'Markel_Insurance_Card_2025.pdf', 'Markel American', 'MAR-2025-00412', '2025-12-31', 'current');

INSERT INTO vessel_documents (id, vessel_id, doc_type, doc_label, file_url, file_name, status) VALUES
  ('00000000-0000-0000-0000-000000002003', '00000000-0000-0000-0000-000000001001', 'boater_card', 'CA Boater Card', 'documents/mxe-00001/CA_Boater_Card.jpg', 'CA_Boater_Card.jpg', 'current');

-- Polaris documents
INSERT INTO vessel_documents (id, vessel_id, doc_type, doc_label, file_url, file_name, reg_state, status) VALUES
  ('00000000-0000-0000-0000-000000002010', '00000000-0000-0000-0000-000000001002', 'registration', 'USCG Documentation', 'documents/mxe-00002/USCG_Documentation_Polaris_2025.pdf', 'USCG_Documentation_Polaris_2025.pdf', 'CA', 'current');

INSERT INTO vessel_documents (id, vessel_id, doc_type, doc_label, file_url, file_name, ins_carrier, ins_expiry, status) VALUES
  ('00000000-0000-0000-0000-000000002011', '00000000-0000-0000-0000-000000001002', 'insurance', 'Marine Insurance', 'documents/mxe-00002/Novamar_Markel_Policy_2025.pdf', 'Novamar_Markel_Policy_2025.pdf', 'Markel American', '2025-12-31', 'current');

INSERT INTO vessel_documents (id, vessel_id, doc_type, doc_label, file_url, file_name, status) VALUES
  ('00000000-0000-0000-0000-000000002012', '00000000-0000-0000-0000-000000001002', 'charter_agreement', 'Charter Program Agreement', 'documents/mxe-00002/ModernSailing_Charter_Agreement_2026.pdf', 'ModernSailing_Charter_Agreement_2026.pdf', 'current');


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 5: qr_tokens (one per vessel)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS qr_tokens (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id   UUID UNIQUE NOT NULL REFERENCES vessels(id) ON DELETE CASCADE,
  mxe_id      TEXT UNIQUE NOT NULL,
  token       TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- The public URL becomes: moxie.sh/{MXE_ID}?scan=1
-- This URL is PERMANENT — never changes even if vessel data updates.

INSERT INTO qr_tokens (id, vessel_id, mxe_id, token) VALUES
  ('00000000-0000-0000-0000-000000003001', '00000000-0000-0000-0000-000000001001', 'MXE-00001', 'mxe-00001-discovery-one'),
  ('00000000-0000-0000-0000-000000003002', '00000000-0000-0000-0000-000000001002', 'MXE-00002', 'mxe-00002-polaris');


-- ────────────────────────────────────────────────────────────────────────────
-- TABLE 6: waitlist (for homepage email capture)
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS waitlist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email      TEXT NOT NULL,
  source     TEXT DEFAULT 'homepage',   -- where the signup came from
  created_at TIMESTAMPTZ DEFAULT now()
);


-- ────────────────────────────────────────────────────────────────────────────
-- RLS POLICIES (commented out — enable after testing)
-- ────────────────────────────────────────────────────────────────────────────

-- ALTER TABLE vessels ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE vessel_documents ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- -- Owners can read/update their own vessels
-- CREATE POLICY "owner_own_vessels" ON vessels
--   FOR ALL USING (owner_id = auth.uid());

-- -- Marina operators see vessels at their marina
-- CREATE POLICY "operator_marina_vessels" ON vessels
--   FOR SELECT USING (
--     marina_id IN (
--       SELECT marina_id FROM users
--       WHERE id = auth.uid() AND role = 'marina_operator'
--     )
--   );

-- -- Public can read basic vessel info (for QR scan page)
-- CREATE POLICY "public_vessel_read" ON vessels
--   FOR SELECT USING (is_public = true);

-- -- Owners can manage their own documents
-- CREATE POLICY "owner_own_docs" ON vessel_documents
--   FOR ALL USING (
--     vessel_id IN (SELECT id FROM vessels WHERE owner_id = auth.uid())
--   );


-- ════════════════════════════════════════════════════════════════════════════
-- VALIDATION QUERIES — run these after seeding to verify integrity
-- ════════════════════════════════════════════════════════════════════════════

-- Should return 2 vessels
-- SELECT mxe_id, vessel_name, make, model, year FROM vessels ORDER BY mxe_id;

-- Should return 6 documents (3 per vessel)
-- SELECT v.mxe_id, d.doc_type, d.doc_label, d.status
-- FROM vessel_documents d JOIN vessels v ON d.vessel_id = v.id
-- ORDER BY v.mxe_id, d.doc_type;

-- Should return 3 marinas
-- SELECT name, city, region FROM marinas ORDER BY name;

-- Should return 2 QR tokens
-- SELECT mxe_id, token FROM qr_tokens ORDER BY mxe_id;

-- Verify foreign key integrity
-- SELECT v.mxe_id, u.full_name AS owner, m.name AS marina
-- FROM vessels v
-- JOIN users u ON v.owner_id = u.id
-- JOIN marinas m ON v.marina_id = m.id;
