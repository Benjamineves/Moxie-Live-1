-- Owner-side vessel/document/photo editing (see build spec).

-- Boater card becomes a real uploadable/replaceable document, matching
-- doc_registration_url/doc_insurance_url's existing pattern, rather than
-- staying just the ca_boater_card boolean flag ("included on every plan").
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_boater_card_url TEXT;

-- upload(..., { upsert: true }) — already used by intake and the photo
-- nudge for photo_url/doc_registration_url/doc_insurance_url — needs an
-- UPDATE policy on storage.objects to actually overwrite a path that
-- already has an object at it, not just the INSERT policies below (which
-- only cover the object-doesn't-exist-yet case). Without this, replacing
-- an existing photo or document fails at the Storage layer even though
-- the app-level upload call looks identical to a first-time upload.
-- Same (loose, any-authenticated-user) condition as the existing INSERT
-- policies — not tightening to path-ownership here, that's a separate,
-- unrequested change from what this migration is for.
DROP POLICY IF EXISTS "Owner replace vessel photos" ON storage.objects;
CREATE POLICY "Owner replace vessel photos" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL
  ) WITH CHECK (
    bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Owner replace vessel docs" ON storage.objects;
CREATE POLICY "Owner replace vessel docs" ON storage.objects
  FOR UPDATE USING (
    bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
  ) WITH CHECK (
    bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
  );
