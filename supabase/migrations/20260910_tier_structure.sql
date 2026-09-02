-- Moxie Digital: tier structure — Basic becomes a real subscription,
-- vessel caps become tier-aware.
--
-- Numbers here MUST stay in sync with web/src/lib/tier-config.ts by
-- hand — Postgres and TypeScript can't share one literal source, so
-- both sides are clearly commented pointing at each other. If you
-- change a limit, change it in both places.
--
--   basic: 2 vessels    (tier-config.ts: VESSEL_LIMIT.basic)
--   full:  5 vessels    (tier-config.ts: VESSEL_LIMIT.full)

CREATE OR REPLACE FUNCTION vessel_limit_for_tier(p_tier TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE WHEN p_tier = 'full' THEN 5 ELSE 2 END;
$$;

COMMENT ON FUNCTION vessel_limit_for_tier IS
  'Single SQL-side source for the per-tier vessel cap — keep in sync with VESSEL_LIMIT in web/src/lib/tier-config.ts. basic=2, full=5.';

-- ────────────────────────────────────────────────────────────────────────────
-- reactivate_vessel — was a flat vessel_limit CONSTANT INTEGER := 5.
-- Now looks up the SELLER's own tier (the one regaining the vessel).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reactivate_vessel(p_vessel_id UUID, p_admin_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v RECORD;
  active_count INTEGER;
  owner_tier TEXT;
  vessel_limit INTEGER;
BEGIN
  SELECT id, owner_id, lifecycle_status INTO v FROM vessels WHERE id = p_vessel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel % not found', p_vessel_id;
  END IF;
  IF v.lifecycle_status <> 'decommissioned' THEN
    RAISE EXCEPTION 'Vessel % is not decommissioned', p_vessel_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(v.owner_id::text));

  SELECT subscription_tier INTO owner_tier FROM users WHERE id = v.owner_id;
  vessel_limit := vessel_limit_for_tier(owner_tier);

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = v.owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count >= vessel_limit THEN
    RAISE EXCEPTION 'Reactivating this vessel would put the owner at % vessels (limit % on their current plan). They must decommission or transfer away another vessel first.',
      active_count + 1, vessel_limit;
  END IF;

  UPDATE vessels
    SET lifecycle_status = 'active',
        decommissioned_at = NULL,
        decommission_reason = NULL
    WHERE id = p_vessel_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- accept_ownership_transfer — was a flat vessel_limit CONSTANT INTEGER
-- := 5. Now looks up the BUYER's own tier.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION accept_ownership_transfer(p_transfer_id UUID, p_buyer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  active_count INTEGER;
  owner_tier TEXT;
  vessel_limit INTEGER;
BEGIN
  SELECT * INTO t FROM ownership_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF t.expires_at < now() AND t.status = 'pending' THEN
    UPDATE ownership_transfers SET status = 'expired', expired_at = now() WHERE id = p_transfer_id;
    RAISE EXCEPTION 'This transfer link has expired.';
  END IF;

  IF t.status <> 'pending' THEN
    RAISE EXCEPTION 'This transfer is no longer awaiting acceptance (status: %)', t.status;
  END IF;

  IF t.seller_id = p_buyer_id THEN
    RAISE EXCEPTION 'You cannot accept a transfer of your own vessel.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(p_buyer_id::text));

  SELECT subscription_tier INTO owner_tier FROM users WHERE id = p_buyer_id;
  vessel_limit := vessel_limit_for_tier(owner_tier);

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = p_buyer_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count >= vessel_limit THEN
    RAISE EXCEPTION 'Accepting this vessel would put you at % vessels (limit % on your current plan). Decommission or transfer away another vessel first.',
      active_count + 1, vessel_limit;
  END IF;

  UPDATE ownership_transfers
    SET buyer_id = p_buyer_id, status = 'awaiting_payment', accepted_at = now()
    WHERE id = p_transfer_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- reverse_ownership_transfer — was a flat vessel_limit CONSTANT INTEGER
-- := 5. Now looks up the SELLER's own tier (the one regaining the vessel).
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reverse_ownership_transfer(p_transfer_id UUID, p_admin_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  active_count INTEGER;
  owner_tier TEXT;
  vessel_limit INTEGER;
BEGIN
  SELECT * INTO t FROM ownership_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;
  IF t.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed transfer can be reversed (status: %)', t.status;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(t.seller_id::text));

  SELECT subscription_tier INTO owner_tier FROM users WHERE id = t.seller_id;
  vessel_limit := vessel_limit_for_tier(owner_tier);

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = t.seller_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count >= vessel_limit THEN
    RAISE EXCEPTION 'Reversing this transfer would put the seller at % vessels (limit % on their current plan). They must decommission or transfer away another vessel first.',
      active_count + 1, vessel_limit;
  END IF;

  UPDATE vessels SET owner_id = t.seller_id WHERE id = t.vessel_id;

  UPDATE ownership_history
    SET ownership_end = CURRENT_DATE, transfer_type = 'other'
    WHERE vessel_id = t.vessel_id AND ownership_end IS NULL;
  INSERT INTO ownership_history (vessel_id, owner_name, ownership_start, ownership_end, transfer_type, notes)
    SELECT t.vessel_id, owner_name, CURRENT_DATE, NULL, 'other', 'Reversed by admin'
    FROM ownership_history
    WHERE vessel_id = t.vessel_id AND ownership_end = CURRENT_DATE
    ORDER BY created_at DESC LIMIT 1;

  UPDATE ownership_transfers
    SET status = 'reversed', reversed_at = now(), reversed_by = p_admin_email
    WHERE id = p_transfer_id;
END;
$$;
