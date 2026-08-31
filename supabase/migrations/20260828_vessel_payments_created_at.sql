-- Moxie Digital: vessel_payments.created_at (build spec §3).
--
-- The live table was missing this column — build spec §3's vessel_payments
-- definition lists it, but the original migration that created the table
-- didn't include it. Nothing in the app writes to it (the webhook sets
-- paid_at explicitly instead), so its absence never broke an insert; this
-- just brings the live schema in line with the spec.

ALTER TABLE vessel_payments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();
