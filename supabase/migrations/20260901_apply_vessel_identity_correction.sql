-- Replaces the old "mark resolved" bookkeeping-only action with a single
-- atomic apply: writes requested_value to the vessel and resolves the
-- request in one transaction, so a request can never end up marked
-- resolved without the value actually having changed (or vice versa).
-- Runs as the caller's role (service_role, which already bypasses RLS —
-- no SECURITY DEFINER needed). Because the vessels UPDATE happens inside
-- this same transaction, vessel_identity_audit's trigger (see
-- 20260830_vessel_identity_lock_and_audit.sql) fires as part of the same
-- atomic step — the audit row and the value change both land or neither
-- does. set_config('app.changed_by', ...) also means this specific path
-- reliably populates changed_by with the approving admin's email, unlike
-- a raw SQL-editor edit outside this flow.

CREATE OR REPLACE FUNCTION apply_vessel_identity_correction(p_request_id UUID, p_admin_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM vessel_identity_correction_requests
    WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found or already resolved', p_request_id;
  END IF;

  PERFORM set_config('app.changed_by', p_admin_email, true);

  IF req.field_name = 'hin' THEN
    UPDATE vessels SET hin = req.requested_value WHERE id = req.vessel_id;
  ELSIF req.field_name = 'make' THEN
    UPDATE vessels SET make = req.requested_value WHERE id = req.vessel_id;
  ELSIF req.field_name = 'model' THEN
    UPDATE vessels SET model = req.requested_value WHERE id = req.vessel_id;
  ELSIF req.field_name = 'year' THEN
    UPDATE vessels SET year = req.requested_value::INTEGER WHERE id = req.vessel_id;
  ELSIF req.field_name = 'length_ft' THEN
    UPDATE vessels SET length_ft = req.requested_value::DECIMAL WHERE id = req.vessel_id;
  ELSIF req.field_name = 'draft_ft' THEN
    UPDATE vessels SET draft_ft = req.requested_value::DECIMAL WHERE id = req.vessel_id;
  ELSIF req.field_name = 'engine' THEN
    UPDATE vessels SET engine = req.requested_value WHERE id = req.vessel_id;
  ELSE
    RAISE EXCEPTION 'Unknown locked field_name: %', req.field_name;
  END IF;

  UPDATE vessel_identity_correction_requests
    SET status = 'resolved', resolved_at = now()
    WHERE id = p_request_id;
END;
$$;
