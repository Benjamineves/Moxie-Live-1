-- vessel-photos: writes limited to the uploader's own folder, no anonymous
-- listing; both upload buckets get a size and type limit.
--
-- LIVE BEFORE THIS (security snapshot 2026-09-25 05:06 UTC):
--   "Owner upload vessel photos"   INSERT  WITH CHECK bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL   roles {public}
--   "Owner replace vessel photos"  UPDATE  USING/WITH CHECK, same                                            roles {public}
--   "Public read vessel photos"    SELECT  USING bucket_id = 'vessel-photos'                                  roles {public}
--   vessel-photos: public = true,  file_size_limit NULL, allowed_mime_types NULL
--   vessel-docs:   public = false, file_size_limit NULL, allowed_mime_types NULL
-- So any signed-in account could replace any vessel's public photo, or put
-- any file of any size and type (HTML, SVG) into a publicly served bucket;
-- and anon could list every owner's folder (auth uids, MXE folders).
--
-- AFTER
--   * vessel-photos SELECT/INSERT/UPDATE for authenticated, own folder only
--     ((storage.foldername(name))[1] = auth.uid()). SELECT stays because
--     upsert needs it; the photo upload path is `${user.id}/${pathKey}/photo`
--     (lib/vessel-uploads.ts), so no upload changes. No DELETE policy, as
--     before — nothing deletes photos with a user session.
--   * The public read policy is dropped. Public photo URLs
--     (/storage/v1/object/public/...) are served because the BUCKET is
--     public, not by that policy; it only added listing and API reads.
--   * Both buckets: file_size_limit 10 MB, allowed_mime_types an explicit
--     list mirroring web/src/lib/upload-limits.ts (upload-limits.test.mts
--     fails if they drift). No image/* wildcard: it admits SVG.
--
-- EXISTING OBJECTS: unaffected — limits apply to new uploads only. Checked
-- 2026-09-25: photos 19 JPEG + 3 WebP (max 3.6 MB), docs 5 PDF + 4 JPEG +
-- 1 PNG (max 7.2 MB); all would pass anyway.
--
-- DEPLOY ORDER: after the commit adding lib/upload-limits.ts is live, so a
-- refused file gets the app's message. ROLLBACK:
-- supabase/rollbacks/20261012_storage_bucket_limits_and_photo_policies.rollback.sql

BEGIN;

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 WHERE id = 'vessel-photos';

UPDATE storage.buckets
   SET file_size_limit = 10485760,
       allowed_mime_types = ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
 WHERE id = 'vessel-docs';

DROP POLICY IF EXISTS "Owner upload vessel photos" ON storage.objects;
DROP POLICY IF EXISTS "Owner replace vessel photos" ON storage.objects;
DROP POLICY IF EXISTS "Public read vessel photos" ON storage.objects;

CREATE POLICY "vessel-photos: read own folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vessel-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "vessel-photos: upload to own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vessel-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "vessel-photos: replace in own folder" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vessel-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'vessel-photos' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- Guard: roll the whole file back unless the end state is exactly this.
DO $$
DECLARE
  n int;
  p record;
BEGIN
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%vessel-photos%';
  IF n <> 3 THEN
    RAISE EXCEPTION 'Expected 3 vessel-photos policies, found %. Rolling back.', n;
  END IF;

  -- Every policy on either upload bucket: authenticated only, own folder only.
  FOR p IN
    SELECT policyname, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || coalesce(with_check, '')) ~ 'vessel-(photos|docs)'
  LOOP
    IF p.roles <> ARRAY['authenticated']::name[] THEN
      RAISE EXCEPTION 'Policy "%" applies to %, not authenticated only. Rolling back.', p.policyname, p.roles;
    END IF;
    IF (p.qual IS NOT NULL AND p.qual NOT LIKE '%foldername%auth.uid()%')
       OR (p.with_check IS NOT NULL AND p.with_check NOT LIKE '%foldername%auth.uid()%') THEN
      RAISE EXCEPTION 'Policy "%" is not folder-scoped. Rolling back.', p.policyname;
    END IF;
  END LOOP;

  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%bucket_id%';
  IF n <> 0 THEN
    RAISE EXCEPTION '% storage.objects policy/policies do not check bucket_id. Rolling back.', n;
  END IF;

  IF (SELECT public FROM storage.buckets WHERE id = 'vessel-photos') IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'vessel-photos must stay public (photo URLs depend on it). Rolling back.';
  END IF;
  IF (SELECT public FROM storage.buckets WHERE id = 'vessel-docs') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'vessel-docs must stay private. Rolling back.';
  END IF;

  SELECT count(*) INTO n
    FROM storage.buckets
   WHERE id IN ('vessel-photos', 'vessel-docs')
     AND file_size_limit = 10485760
     AND NOT ('image/svg+xml' = ANY (allowed_mime_types))
     AND 'image/jpeg' = ANY (allowed_mime_types);
  IF n <> 2 THEN
    RAISE EXCEPTION 'Bucket limits not applied to both upload buckets. Rolling back.';
  END IF;
END $$;

COMMIT;
