-- Moxie Digital: subscriptions become account-level, not per-vessel.
--
-- Build spec §9 item 16 flagged this as an open question and confirmed it
-- live: an owner picking "Full" on two separate vessels ended up with two
-- independent Stripe subscriptions on the same customer, not one plan
-- covering both. That was a bug, not a decision — this migration is the
-- schema half of the fix. See the webhook and payment-action changes in
-- the same deploy for the other half.
--
-- The model going forward:
--   * Badge fee — one-time PaymentIntent, per vessel, always (real physical
--     good, real per-unit cost). Unchanged in shape, just no longer tied to
--     a tier choice. Still logged in vessel_payments.
--   * Subscription — ONE Stripe Subscription per account, covering every
--     vessel that account owns. users.subscription_tier/subscription_status
--     already modeled this correctly; only creation (payment/actions.ts)
--     was wrong, creating a new one per vessel instead of reusing the
--     account's existing one.
--
-- BACKWARD COMPATIBLE. Both changes below are additive — currently-
-- deployed code keeps working unchanged after this runs. Safe to run
-- before the matching deploy goes live.

-- One Stripe Subscription ID per account, now that there's genuinely only
-- ever one. Simpler than the vessel-level version once floated for this —
-- no per-vessel ambiguity to resolve, no live Stripe metadata lookup ever
-- needed to answer "does this account have an active subscription, and
-- which one." Set when the subscription is created (dashboard/upgrade's
-- action); left in place after cancellation as a historical record, same
-- as stripe_customer_id is never cleared — subscription_status remains the
-- source of truth for "is it active right now."
ALTER TABLE users ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- ────────────────────────────────────────────────────────────────────────────
-- account_payments — subscription charges, account-scoped
--
-- vessel_payments (vessel_id NOT NULL) stays exactly what it already was:
-- the log of one-time badge fees, one row per vessel activation. A
-- recurring subscription charge no longer has a single vessel to
-- attribute itself to, so it doesn't belong in that table — this is a
-- parallel table for the other kind of charge, not a replacement.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS account_payments (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id           UUID NOT NULL REFERENCES users(id),
  stripe_invoice_id  TEXT NOT NULL,
  amount_cents       INTEGER,
  status             TEXT NOT NULL DEFAULT 'paid',
  paid_at            TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Same idempotency backstop as vessel_payments_stripe_payment_intent_id_key
-- (20260827_payment_integration.sql) — a duplicate webhook delivery for the
-- same invoice can never insert two paid rows.
CREATE UNIQUE INDEX IF NOT EXISTS account_payments_stripe_invoice_id_key
  ON account_payments (stripe_invoice_id);

CREATE INDEX IF NOT EXISTS idx_account_payments_owner ON account_payments(owner_id);

-- Locked down like vessel_payments — every read/write goes through the
-- service-role client; this owner-read policy is forward-looking hygiene
-- for whenever a client-side read path exists, not something the app
-- relies on today (getOwnerBillingSummary already uses the service role).
ALTER TABLE account_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own account payments" ON account_payments;
CREATE POLICY "Owners read own account payments" ON account_payments
  FOR SELECT USING (owner_id = auth.uid());

COMMENT ON TABLE account_payments IS
  'Recurring Full Access subscription charges, one row per paid invoice. Account-scoped (owner_id), not vessel-scoped — see vessel_payments for the separate per-vessel badge-fee log.';
