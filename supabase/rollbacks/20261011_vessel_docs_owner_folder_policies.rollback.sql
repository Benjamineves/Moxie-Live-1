-- ROLLBACK for migrations/20261011_vessel_docs_owner_folder_policies.sql.
--
-- Restores the three vessel-docs policies EXACTLY as pg_policies showed them
-- live on 2026-09-24 (roles {public}, no DELETE policy). That state lets ANY
-- signed-in account list, read and overwrite every owner's documents — run
-- this only to undo a breakage, and re-apply 20261011 once fixed.
--
-- Not a migration: kept outside supabase/migrations/ so no tooling runs it.

BEGIN;

DROP POLICY IF EXISTS "vessel-docs: read own folder" ON storage.objects;
DROP POLICY IF EXISTS "vessel-docs: upload to own folder" ON storage.objects;
DROP POLICY IF EXISTS "vessel-docs: replace in own folder" ON storage.objects;
DROP POLICY IF EXISTS "vessel-docs: delete from own folder" ON storage.objects;

CREATE POLICY "Owner read vessel docs" ON storage.objects
  FOR SELECT USING (bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL);

CREATE POLICY "Owner upload vessel docs" ON storage.objects
  FOR INSERT WITH CHECK (bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL);

CREATE POLICY "Owner replace vessel docs" ON storage.objects
  FOR UPDATE USING (bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL)
  WITH CHECK (bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL);

COMMIT;
