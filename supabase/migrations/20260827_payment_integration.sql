-- Moxie Digital: payment integration support (P0-C, build spec §4/§14).
--
-- Idempotency backstop for the Stripe webhook receiver: a unique index on
-- vessel_payments.stripe_payment_intent_id means a duplicate webhook
-- delivery (Stripe sends at-least-once) or a double-submitted payment can
-- never insert two paid rows for the same PaymentIntent, on top of the
-- application-level "check before insert" the webhook handler also does.
-- A plain UNIQUE index allows multiple NULLs (Postgres default semantics),
-- which matters here since not every vessel_payments row is expected to
-- carry a stripe_payment_intent_id in all cases.
--
-- CREATE UNIQUE INDEX IF NOT EXISTS is idempotent — safe to re-run.

CREATE UNIQUE INDEX IF NOT EXISTS vessel_payments_stripe_payment_intent_id_key
  ON vessel_payments (stripe_payment_intent_id);

-- The column holds two different kinds of Stripe object ID depending on
-- payment_type — worth documenting on the column itself, not just in the
-- webhook code, since anyone querying this table later will hit the same
-- "why does this look like an invoice id" question.
COMMENT ON COLUMN vessel_payments.stripe_payment_intent_id IS
  'Stripe object ID used as idempotency key. Holds a PaymentIntent ID (pi_...) for one-time setup_fee payments, or an Invoice ID (in_...) for subscription payments — Stripe removed Invoice.payment_intent in recent API versions. Both are globally unique.';
