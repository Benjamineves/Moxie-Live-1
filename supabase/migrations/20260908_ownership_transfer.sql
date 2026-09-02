-- Moxie Digital: Ownership Transfer.
--
-- Seller initiates -> buyer accepts -> seller pays the transfer fee ->
-- ownership moves. A status change plus a genuine change of owner_id --
-- never a deletion. The vessel record, its MXE ID, and its identity
-- documents persist; only which account controls it, and which
-- owner-specific data is attached, changes.
--
-- Table name matches what docs/moxie_digital_technical_spec_share_profile.md
-- already cross-references ("Ownership Transfer spec... Phase 4") for the
-- vessel_shares revocation this migration also implements.

-- ────────────────────────────────────────────────────────────────────────────
-- ownership_transfers
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS ownership_transfers (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id                   UUID NOT NULL REFERENCES vessels(id),
  mxe_id                      TEXT NOT NULL,
  seller_id                   UUID NOT NULL REFERENCES users(id),

  -- Phase-2 seam: v1's only caller is the owner's own server action,
  -- which always sets initiated_by = seller_id and initiated_via =
  -- 'owner'. A future escrow/title-company API would call the same
  -- underlying initiateOwnershipTransfer() with a different
  -- authenticated actor -- nothing about "who's allowed to initiate"
  -- is hardcoded into the schema or the atomic functions below, only
  -- into the v1 server action that gates who may call them.
  initiated_by                UUID NOT NULL REFERENCES users(id),
  initiated_via               TEXT NOT NULL DEFAULT 'owner' CHECK (initiated_via IN ('owner', 'escrow')),

  buyer_email                 TEXT NOT NULL,
  buyer_id                    UUID REFERENCES users(id),  -- set at acceptance, once resolved/created

  token_hash                  TEXT NOT NULL UNIQUE,        -- sha256, same generateShareToken()/hashShareToken() as vessel_shares

  status                      TEXT NOT NULL DEFAULT 'pending'
                               CHECK (status IN ('pending', 'awaiting_payment', 'completed', 'expired', 'canceled', 'reversed')),

  transfer_fee_amount_cents   INTEGER,
  stripe_payment_intent_id    TEXT,
  payment_status               TEXT NOT NULL DEFAULT 'not_charged'
                               CHECK (payment_status IN ('not_charged', 'paid', 'failed')),

  -- Full pre-transfer vessel row (minus owner_id), captured the instant
  -- before completion clears the owner-specific columns on the live
  -- row. This is what the seller's read-only "previously owned" page
  -- renders from -- never a live query against vessels, which by then
  -- belongs to the buyer and keeps changing.
  vessel_snapshot              JSONB,

  expires_at                   TIMESTAMPTZ NOT NULL,        -- initiated_at + 7 days; same deadline covers both "buyer never accepted" and "seller never paid"
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at                  TIMESTAMPTZ,                 -- buyer accepted -> entered awaiting_payment
  completed_at                 TIMESTAMPTZ,                 -- seller paid -> entered completed
  canceled_at                  TIMESTAMPTZ,
  expired_at                   TIMESTAMPTZ,
  reversed_at                  TIMESTAMPTZ,
  reversed_by                  TEXT
);

CREATE INDEX IF NOT EXISTS idx_ownership_transfers_vessel ON ownership_transfers(vessel_id);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_seller_status ON ownership_transfers(seller_id, status);
CREATE INDEX IF NOT EXISTS idx_ownership_transfers_status_expires ON ownership_transfers(status, expires_at);

-- Locked down entirely, same reasoning as every other request-style
-- table in this app (vessel_identity_correction_requests,
-- vessel_decommission_requests) -- every read/write goes through the
-- service-role client. Token resolution for the buyer's accept page
-- happens server-side with the service role too (not an anon RLS
-- policy), matching how vessel_shares' token resolve already works.
ALTER TABLE ownership_transfers ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ownership_transfers IS
  'Seller-initiates/buyer-accepts ownership transfer. status: pending -> awaiting_payment (buyer accepted) -> completed (seller paid, ownership moved) | expired | canceled | reversed (admin-only, post-completion).';

-- ────────────────────────────────────────────────────────────────────────────
-- accept_ownership_transfer -- atomic buyer acceptance.
--
-- Advisory-locked on the BUYER's id (not the seller's) so two
-- simultaneous acceptances by the same buyer -- of two different
-- transfers -- can't both read "4 active vessels" and both succeed,
-- landing them at 6. Buyer-email matching against the transfer's
-- buyer_email happens in the calling server action, before this is
-- invoked -- this function trusts that's already been verified and
-- focuses purely on the atomic state transition + cap check.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION accept_ownership_transfer(p_transfer_id UUID, p_buyer_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  active_count INTEGER;
  vessel_limit CONSTANT INTEGER := 5;
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

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = p_buyer_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count >= vessel_limit THEN
    RAISE EXCEPTION 'Accepting this vessel would put you at % vessels (limit %). Decommission or transfer away another vessel first.',
      active_count + 1, vessel_limit;
  END IF;

  UPDATE ownership_transfers
    SET buyer_id = p_buyer_id, status = 'awaiting_payment', accepted_at = now()
    WHERE id = p_transfer_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- complete_ownership_transfer -- atomic completion, called from the
-- Stripe webhook once the seller's transfer-fee payment succeeds.
--
-- Idempotent: a webhook retry against an already-completed transfer is
-- a harmless no-op (RETURN, not an exception), same pattern as
-- activateVessel's qr_status guard in the webhook handler.
--
-- Captures vessel_snapshot as the FULL pre-transfer row (to_jsonb(v)
-- minus owner_id) -- not just the vessel-intrinsic subset -- because
-- the seller's frozen "previously owned" page needs their own
-- owner-specific data too (their documents, their insurance, their
-- contact info as of that moment), which is about to be cleared from
-- the live row below.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION complete_ownership_transfer(p_transfer_id UUID, p_stripe_payment_intent_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  v RECORD;
  snap JSONB;
  buyer_name TEXT;
BEGIN
  SELECT * INTO t FROM ownership_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;

  IF t.status = 'completed' THEN
    RETURN;  -- already processed by an earlier webhook delivery
  END IF;
  IF t.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Transfer is not awaiting payment (status: %)', t.status;
  END IF;

  SELECT * INTO v FROM vessels WHERE id = t.vessel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vessel % not found', t.vessel_id;
  END IF;

  snap := to_jsonb(v) - 'owner_id';

  SELECT full_name INTO buyer_name FROM users WHERE id = t.buyer_id;

  -- ownership_history: close the seller's tenure, open the buyer's.
  -- This is the first time this table (build spec §11's extensibility
  -- hook) is ever actually written to. If no open row exists for this
  -- vessel (true for every vessel today -- nothing has populated this
  -- table before now), fall back to the vessel's own created_at as the
  -- seller's ownership_start, since that's the best available proxy
  -- for "when they became the owner of this MXE ID."
  IF EXISTS (SELECT 1 FROM ownership_history WHERE vessel_id = t.vessel_id AND ownership_end IS NULL) THEN
    UPDATE ownership_history
      SET ownership_end = CURRENT_DATE,
          transfer_type = CASE WHEN t.initiated_via = 'escrow' THEN 'escrow_sale' ELSE 'private_sale' END
      WHERE vessel_id = t.vessel_id AND ownership_end IS NULL;
  ELSE
    INSERT INTO ownership_history (vessel_id, owner_name, ownership_start, ownership_end, transfer_type)
    VALUES (
      t.vessel_id, COALESCE(v.owner_name, 'Unknown'), v.created_at::date, CURRENT_DATE,
      CASE WHEN t.initiated_via = 'escrow' THEN 'escrow_sale' ELSE 'private_sale' END
    );
  END IF;

  INSERT INTO ownership_history (vessel_id, owner_name, ownership_start, ownership_end, transfer_type)
  VALUES (t.vessel_id, COALESCE(buyer_name, 'New owner'), CURRENT_DATE, NULL, NULL);

  -- Owner-specific fields cleared on the live row -- not because the
  -- data is discarded (it's already safe in snap above), but because
  -- leaving them in place would mean the buyer's own future edits
  -- overwrite the seller's historical values in place, corrupting the
  -- frozen record snap was just built to protect. Storage/marina and
  -- registration fields reset too (confirmed decisions): stale data
  -- that looks current is worse than a blank field prompting the new
  -- owner to fill it in.
  UPDATE vessels SET
    owner_id = t.buyer_id,
    owner_name = NULL, owner_phone = NULL, owner_email = NULL, preferred_contact = NULL,
    emg_name = NULL, emg_phone = NULL, emg_relationship = NULL,
    ins_carrier = NULL, ins_broker = NULL, ins_policy = NULL, ins_expiry = NULL, ins_liability = NULL,
    doc_insurance_url = NULL,
    doc_boater_card_url = NULL, ca_boater_card = NULL,
    reg_state = NULL, reg_number = NULL, reg_expiry = NULL,
    storage_type = NULL, storage_description = NULL, storage_state = NULL, storage_city = NULL,
    marina_name = NULL, marina_city = NULL, slip_number = NULL, marina_phone = NULL,
    is_liveaboard = NULL, slip_notes = NULL,
    public_notes = NULL
  WHERE id = t.vessel_id;

  UPDATE vessel_shares SET revoked_at = now() WHERE vessel_id = t.vessel_id AND revoked_at IS NULL;

  UPDATE ownership_transfers
    SET status = 'completed', completed_at = now(), payment_status = 'paid',
        stripe_payment_intent_id = p_stripe_payment_intent_id, vessel_snapshot = snap
    WHERE id = p_transfer_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- reverse_ownership_transfer -- admin-only, post-completion.
--
-- Undoes OWNERSHIP, not CONTENT: flips owner_id back to the seller but
-- never touches the live vessel row's field values, which may hold
-- real data the buyer has since entered. Restoring vessel_snapshot
-- here would risk destroying that -- the seller gets the vessel back
-- as it currently stands, not rewound to the moment before transfer.
-- Advisory-locked on the seller's id for the same reason acceptance is
-- locked on the buyer's -- the seller may have registered new vessels
-- since transferring this one away, so the cap check needs the same
-- concurrency guard reactivate_vessel already established.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reverse_ownership_transfer(p_transfer_id UUID, p_admin_email TEXT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  t RECORD;
  active_count INTEGER;
  vessel_limit CONSTANT INTEGER := 5;
BEGIN
  SELECT * INTO t FROM ownership_transfers WHERE id = p_transfer_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer % not found', p_transfer_id;
  END IF;
  IF t.status <> 'completed' THEN
    RAISE EXCEPTION 'Only a completed transfer can be reversed (status: %)', t.status;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(t.seller_id::text));

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = t.seller_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count >= vessel_limit THEN
    RAISE EXCEPTION 'Reversing this transfer would put the seller at % vessels (limit %). They must decommission or transfer away another vessel first.',
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
