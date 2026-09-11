-- Stage 3: a dedupe key on owner_notifications.
--
-- WHY A COLUMN AND NOT A TIME WINDOW
--
-- Stage 2's deduplication keys on (owner, type, vessel) inside a window
-- measured in days, because what it absorbs is Stripe redelivering the
-- same webhook for one ongoing payment failure. Time is the right axis
-- there: the repeats are the same episode precisely because they are
-- close together.
--
-- Transfer events are not like that. They are user-initiated, they
-- happen once, and a seller may legitimately cancel a transfer and start
-- a fresh one to the same buyer for the same vessel minutes later. Under
-- stage 2's rules the second transfer's emails would be suppressed as
-- duplicates of the first — which is not a duplicate at all, it is a new
-- episode that the buyer and seller both need to hear about.
--
-- So transfer notifications key on the transfer's own id. Two events
-- belong to the same episode if and only if they belong to the same
-- transfer, regardless of how much time has passed.
--
-- DELIBERATELY NOT UNIQUE
--
-- A unique index would make deduplication structural — the second insert
-- would simply fail. That would be the wrong behaviour, because it would
-- suppress the in-app ROW as well as the email, and stage 2's contract is
-- that the row is the record and is always written. This column exists to
-- be queried before sending, nothing more.
--
-- Nullable, and null for every notification that is not transfer-scoped;
-- those continue to use the window.

ALTER TABLE owner_notifications
  ADD COLUMN IF NOT EXISTS dedupe_key TEXT;

COMMENT ON COLUMN owner_notifications.dedupe_key IS
  'Optional episode identifier for email deduplication — the transfer id for transfer notifications, null for account-level ones which dedupe on a time window instead. NOT unique: the in-app row is always written, this only suppresses a repeat email.';

-- Partial, because the overwhelming majority of rows will never carry a
-- key and there is no reason to index their nulls.
CREATE INDEX IF NOT EXISTS owner_notifications_dedupe_key_idx
  ON owner_notifications (dedupe_key)
  WHERE dedupe_key IS NOT NULL;
