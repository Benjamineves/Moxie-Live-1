-- Support-mediated correction request queue for the locked, identity-
-- defining vessel fields (hin, make, model, year, length_ft, draft_ft,
-- engine). Owners have no direct edit path to these (see
-- 20260830_vessel_identity_lock_and_audit.sql) — this table is the
-- request record: an owner submits what they believe the correct value
-- is, with a required supporting document, and an admin reviews it and
-- applies the fix directly in the database if it checks out. Submitting
-- a request never writes to vessels itself; the eventual direct-DB fix is
-- what the identity audit log trigger captures, separately.
--
-- Deliberately minimal — "an admin-visible request queue, not a full
-- workflow": no state machine beyond pending/resolved, no automated
-- verification of the document against the requested value.

CREATE TABLE IF NOT EXISTS vessel_identity_correction_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES vessels(id),
  mxe_id TEXT NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id),
  field_name TEXT NOT NULL,           -- one of: hin, make, model, year, length_ft, draft_ft, engine
  current_value TEXT,                 -- snapshot of the field at request time, for reviewer context
  requested_value TEXT NOT NULL,
  document_path TEXT NOT NULL,        -- vessel-docs storage path — a current registration/title doc showing the corrected value; required, not optional
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'resolved'
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

-- Locked down entirely, same reasoning as vessel_identity_audit_log: every
-- read/write goes through the service-role client (owner submission via
-- a server action, admin review via the admin page) — no anon/owner RLS
-- policy is needed or added.
ALTER TABLE vessel_identity_correction_requests ENABLE ROW LEVEL SECURITY;
