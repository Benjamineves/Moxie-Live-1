-- Moxie Digital: vessel Archive/Decommission.
--
-- A status change, never a deletion. The vessel record, its documents,
-- ownership history, and audit log all persist untouched — only
-- lifecycle_status changes, plus a denormalized decommissioned_at/
-- decommission_reason for quick display without joining to the request
-- table. The MXE ID is never freed or reused — that's already guaranteed
-- by mxe_id_seq (20260904_mxe_id_sequence.sql) and nothing here touches
-- that.
--
-- Admin-mediated, same pattern as vessel_identity_correction_requests:
-- an owner submits a request, an admin approves (applies the status
-- change atomically) or declines. Unlike correction requests, this flow
-- needs an explicit decline path (there's no equivalent for correction
-- requests today), and needs reactivation, both handled below.
--
-- Deliberately NOT tier-gated -- Basic accounts can archive too. Decommission
-- exists partly to fix mistakes (wrong vessel, duplicate, a sale that
-- fell through); locking that behind a paid tier would leave a Basic
-- owner who made an error stuck with it, which is a support and trust
-- problem out of proportion to any revenue a gate like that would protect.

-- ────────────────────────────────────────────────────────────────────────────
-- vessels: lifecycle_status, separate from qr_status
--
-- qr_status has its own documented one-way invariant (pending_payment ->
-- active, never reverts, PERMANENT once active -- see
-- 20260825_payment_storage_extensibility.sql) about badge/payment
-- activation. lifecycle_status is a different, orthogonal concern (is
-- this vessel currently part of the owner's active fleet) -- reusing
-- qr_status for this would violate its own one-way invariant and
-- conflate two unrelated lifecycles. A vessel can be decommissioned
-- whether or not it was ever activated (e.g. "wrong vessel registered"
-- can happen before the badge fee is ever paid).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS lifecycle_status TEXT NOT NULL DEFAULT 'active';  -- 'active' | 'decommissioned'
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS decommissioned_at TIMESTAMPTZ;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS decommission_reason TEXT;

CREATE INDEX IF NOT EXISTS idx_vessels_lifecycle_status ON vessels(lifecycle_status);

COMMENT ON COLUMN vessels.lifecycle_status IS
  'Fleet-membership status, independent of qr_status (badge activation). ''active'' | ''decommissioned''. Never deleted -- a status change only.';

-- ────────────────────────────────────────────────────────────────────────────
-- vessel_decommission_requests
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS vessel_decommission_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id      UUID NOT NULL REFERENCES vessels(id),
  mxe_id         TEXT NOT NULL,
  owner_id       UUID NOT NULL REFERENCES users(id),
  reason         TEXT NOT NULL CHECK (reason IN
                   ('wrong_vessel', 'duplicate', 'sale_fell_through', 'sold_outside_moxie', 'destroyed_scrapped', 'other')),
  notes          TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',  -- 'pending' | 'approved' | 'declined'
  decline_reason TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at    TIMESTAMPTZ,
  resolved_by    TEXT
);

-- Locked down entirely, same reasoning as vessel_identity_correction_requests
-- -- every read/write goes through the service-role client (owner
-- submission via a server action, admin review via the admin page) — no
-- anon/owner RLS policy is needed or added.
ALTER TABLE vessel_decommission_requests ENABLE ROW LEVEL SECURITY;

-- ────────────────────────────────────────────────────────────────────────────
-- apply_vessel_decommission — atomic approve.
--
-- In one transaction: sets the vessel's lifecycle_status, revokes every
-- active vessel_shares row for it (the exact logic the share-profile
-- spec already documents for ownership transfer -- a decommissioned
-- vessel shouldn't have live vendor links circulating), and resolves the
-- request. All three land together or none do -- a request can never end
-- up approved without the vessel actually changing status, or vice versa.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_vessel_decommission(p_request_id UUID, p_admin_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  req RECORD;
BEGIN
  SELECT * INTO req FROM vessel_decommission_requests
    WHERE id = p_request_id AND status = 'pending';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Request % not found or already resolved', p_request_id;
  END IF;

  UPDATE vessels
    SET lifecycle_status = 'decommissioned',
        decommissioned_at = now(),
        decommission_reason = req.reason
    WHERE id = req.vessel_id;

  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE vessel_id = req.vessel_id AND revoked_at IS NULL;

  UPDATE vessel_decommission_requests
    SET status = 'approved', resolved_at = now(), resolved_by = p_admin_email
    WHERE id = p_request_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- reactivate_vessel — atomic reactivate, cap-guarded.
--
-- pg_advisory_xact_lock keyed on the owner's id serializes concurrent
-- reactivation attempts for the SAME owner (two different vessels being
-- reactivated at once for one owner can't both read "4 active" and both
-- succeed, landing the owner at 6). The lock is released automatically
-- at the end of this transaction. Same tool used for the old MXE-ID
-- sequence lock, applied here for the same reason: a check-then-act race
-- a plain UPDATE ... WHERE can't guard against on its own.
--
-- "Active" for the cap means qr_status = 'active' AND lifecycle_status =
-- 'active' — this MUST compose with the cap query in
-- dashboard/new/actions.ts's createVessel, which independently applies
-- the same two-condition filter. A decommissioned vessel keeps whatever
-- qr_status it already had (decommission never touches qr_status), so
-- qr_status alone is not enough to identify "counts against the cap."
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reactivate_vessel(p_vessel_id UUID, p_admin_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  active_count INTEGER;
  vessel_limit CONSTANT INTEGER := 5;
BEGIN
  SELECT id, owner_id, lifecycle_status INTO v FROM vessels WHERE id = p_vessel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel % not found', p_vessel_id;
  END IF;
  IF v.lifecycle_status <> 'decommissioned' THEN
    RAISE EXCEPTION 'Vessel % is not decommissioned', p_vessel_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v.owner_id::text));

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = v.owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count >= vessel_limit THEN
    RAISE EXCEPTION 'Reactivating this vessel would put the owner at % vessels (limit %). Decommission another vessel on this account first.',
      active_count + 1, vessel_limit;
  END IF;

  UPDATE vessels
    SET lifecycle_status = 'active',
        decommissioned_at = NULL,
        decommission_reason = NULL
    WHERE id = p_vessel_id;

  -- No update to vessel_decommission_requests here -- reactivation isn't
  -- "undoing" the original request (which stays approved, a permanent
  -- record of the decommission event that happened), it's a new admin
  -- action on the vessel itself. p_admin_email is accepted for symmetry
  -- with apply_vessel_decommission and to leave room for a future audit
  -- row without changing this function's signature again.
END;
$$;
