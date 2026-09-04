-- Preserve the original filename of each uploaded document.
--
-- uploadVesselDocument (lib/vessel-uploads.ts) writes to a deterministic
-- path — {userId}/{mxeId}/registration.pdf — and stores only that path.
-- The name the owner actually uploaded was discarded, so DocumentsEdit
-- could only read the basename back off the path, which meant every
-- vessel in the system displayed the same three strings
-- ("registration.pdf", "insurance.pdf", "boater_card.pdf"). They looked
-- like filenames and carried no information at all.
--
-- Nullable on purpose, and NOT backfilled: the original names for
-- already-uploaded documents were never recorded anywhere, so there is
-- nothing to recover them from. The UI falls back to the storage
-- object's own upload date and size for those rows — never to the path
-- basename, which is the bug this fixes.
--
-- Deliberately NOT touched: complete_ownership_transfer
-- (20260908_ownership_transfer.sql) nulls doc_boater_card_url and
-- ca_boater_card when a vessel changes hands, and does not null the
-- matching filename column added here. That's intentional rather than an
-- oversight — the UI only ever reads a filename for a slot that has a
-- document in it, so a leftover value on a cleared slot is unreachable,
-- and re-declaring that whole plpgsql function to clear one cosmetic
-- nullable column is more drift risk than the tidiness is worth.

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_registration_filename TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_insurance_filename   TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_boater_card_filename TEXT;

COMMENT ON COLUMN vessels.doc_registration_filename IS
  'Original filename as uploaded, for display only. NULL for documents uploaded before this column existed, and for documents uploaded through the intake form (dashboard/new), which writes to Storage directly rather than through uploadVesselDocument. Never derive a display name from doc_registration_url''s basename — it is a deterministic path, identical for every vessel.';
COMMENT ON COLUMN vessels.doc_insurance_filename IS
  'Original filename as uploaded, for display only. See doc_registration_filename.';
COMMENT ON COLUMN vessels.doc_boater_card_filename IS
  'Original filename as uploaded, for display only. See doc_registration_filename.';
