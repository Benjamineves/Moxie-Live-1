-- Locks vessel-intrinsic identity fields against self-serve editing and
-- audits any change to them, however it happens (app code no longer has a
-- path to write these at all after this round — see owner-actions.ts — so
-- in practice this only ever fires on a direct SQL/table-editor edit, which
-- is exactly the case app-layer logging can't see).
--
-- Locked fields: hin, make, model, year, length_ft, draft_ft, engine,
-- uscg_doc_number, official_number, vessel_type — the properties that
-- define which physical object a vessel record represents. Deliberately
-- excludes vessel_name, reg_state, reg_number, reg_expiry, which change
-- legitimately (renaming, re-registration) without the boat becoming a
-- different boat.

CREATE TABLE IF NOT EXISTS vessel_identity_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id UUID NOT NULL REFERENCES vessels(id),
  mxe_id TEXT NOT NULL,             -- denormalized at write time so the log stays readable even if the vessel row is ever removed
  field_name TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Best-effort only. A direct SQL-editor UPDATE has no individually-
  -- identified session the way an app request does (auth.uid() isn't
  -- populated for the dashboard's shared connection role) — this reads a
  -- session-local GUC the operator can optionally set first:
  --   SET LOCAL app.changed_by = 'ben@moxieyachting.com';
  -- If it's not set, changed_by is left null. Nothing enforces that it's
  -- set, so treat this column as "recorded when someone remembered to,"
  -- not as a guaranteed audit trail of who.
  changed_by TEXT
);

-- Locked down entirely — same reasoning as vessel_documents' existing RLS
-- comment: nothing in the app reads this table via a user-scoped client.
-- The only reader is the new admin page, via the service-role client,
-- which bypasses RLS. No anon/owner policy is added on purpose.
ALTER TABLE vessel_identity_audit_log ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION log_vessel_identity_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  actor TEXT := current_setting('app.changed_by', true);
BEGIN
  IF OLD.hin IS DISTINCT FROM NEW.hin THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'hin', OLD.hin, NEW.hin, actor);
  END IF;
  IF OLD.make IS DISTINCT FROM NEW.make THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'make', OLD.make, NEW.make, actor);
  END IF;
  IF OLD.model IS DISTINCT FROM NEW.model THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'model', OLD.model, NEW.model, actor);
  END IF;
  IF OLD.year IS DISTINCT FROM NEW.year THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'year', OLD.year::TEXT, NEW.year::TEXT, actor);
  END IF;
  IF OLD.length_ft IS DISTINCT FROM NEW.length_ft THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'length_ft', OLD.length_ft::TEXT, NEW.length_ft::TEXT, actor);
  END IF;
  IF OLD.draft_ft IS DISTINCT FROM NEW.draft_ft THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'draft_ft', OLD.draft_ft::TEXT, NEW.draft_ft::TEXT, actor);
  END IF;
  IF OLD.engine IS DISTINCT FROM NEW.engine THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'engine', OLD.engine, NEW.engine, actor);
  END IF;
  IF OLD.uscg_doc_number IS DISTINCT FROM NEW.uscg_doc_number THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'uscg_doc_number', OLD.uscg_doc_number, NEW.uscg_doc_number, actor);
  END IF;
  IF OLD.official_number IS DISTINCT FROM NEW.official_number THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'official_number', OLD.official_number, NEW.official_number, actor);
  END IF;
  IF OLD.vessel_type IS DISTINCT FROM NEW.vessel_type THEN
    INSERT INTO vessel_identity_audit_log (vessel_id, mxe_id, field_name, old_value, new_value, changed_by)
    VALUES (NEW.id, NEW.mxe_id, 'vessel_type', OLD.vessel_type, NEW.vessel_type, actor);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS vessel_identity_audit ON vessels;
CREATE TRIGGER vessel_identity_audit
  AFTER UPDATE ON vessels
  FOR EACH ROW
  EXECUTE FUNCTION log_vessel_identity_changes();
