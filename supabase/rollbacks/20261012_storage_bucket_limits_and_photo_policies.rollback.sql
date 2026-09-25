-- ROLLBACK for migrations/20261012_storage_bucket_limits_and_photo_policies.sql.
--
-- Restores the vessel-photos policies and both buckets' limits EXACTLY as the
-- security snapshot showed them live on 2026-09-25 (roles {public}, no
-- limits). That state lets any signed-in account replace any vessel's photo
-- and anon list the bucket — run only to undo a breakage.
--
-- Not a migration: kept outside supabase/migrations/ so no tooling runs it.

BEGIN;

DROP POLICY IF EXISTS "vessel-photos: read own folder" ON storage.objects;
DROP POLICY IF EXISTS "vessel-photos: upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "vessel-photos: replace in own folder" ON storage.objects;

CREATE POLICY "Public read vessel photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'vessel-photos');

CREATE POLICY "Owner upload vessel photos" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL);

CREATE POLICY "Owner replace vessel photos" ON storage.objects
  FOR UPDATE USING (bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL);

UPDATE storage.buckets SET file_size_limit = NULL, allowed_mime_types = NULL
 WHERE id IN ('vessel-photos', 'vessel-docs');

COMMIT;
