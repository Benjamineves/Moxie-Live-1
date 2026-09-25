-- vessel-docs: a signed-in user can touch only their own folder.
--
-- LIVE BEFORE THIS (pg_policies, pasted 2026-09-24 — identical to 20260507 +
-- 20260829):
--   "Owner read vessel docs"     SELECT  USING      bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
--   "Owner upload vessel docs"   INSERT  WITH CHECK bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
--   "Owner replace vessel docs"  UPDATE  USING/WITH CHECK, same
--   (no DELETE policy)
-- "Owner" was in the names only. ANY signed-in account could list the
-- bucket root (every owner's folder), download every registration,
-- insurance card, boater card, fishing license, service-record attachment
-- and correction-request evidence, and overwrite any of them in place.
--
-- AFTER: the path's first folder must be the caller's auth uid, for SELECT,
-- INSERT, UPDATE and DELETE, and only for the authenticated role. Every
-- upload already writes there (lib/vessel-uploads.ts builds
-- `${user.id}/...` from the auth user, including the intake draft folder),
-- so no upload changes. upsert needs SELECT + UPDATE on the object as well
-- as INSERT — all three are scoped the same way.
--
-- NO APP READ DEPENDS ON THE OLD RULE. Every read of this bucket — owner
-- documents, DocumentViewerModal, marina documents, offline save (all via
-- /api/vessels/[mxeId]/documents/[docType]), service-record attachments,
-- admin correction evidence, the previously-owned page (new
-- /api/transfers/[transferId]/documents/[docType]), metadata, usage and
-- cleanup — uses the service role and short-lived signed URLs, which
-- bypass these policies. Current-owner checks live in those routes.
--
-- Known and accepted (option A, 2026-09-24): after a sale, a seller can
-- still read files they themselves uploaded — including a registration
-- that carried to the buyer — because it is in their folder. The buyer
-- reads it through the server route.
--
-- vessel-photos policies are NOT touched here (public bucket; its
-- INSERT/UPDATE have the same any-signed-in-user shape — see the full
-- grants audit).
--
-- EXISTING ROWS: no objects move or change. DEPLOY ORDER: after the commit
-- adding /api/transfers/.../documents is live (nothing breaks if run
-- earlier, but that is the order). ROLLBACK: supabase/rollbacks/
-- 20261011_vessel_docs_owner_folder_policies.rollback.sql.

BEGIN;

DROP POLICY IF EXISTS "Owner read vessel docs" ON storage.objects;
DROP POLICY IF EXISTS "Owner upload vessel docs" ON storage.objects;
DROP POLICY IF EXISTS "Owner replace vessel docs" ON storage.objects;

CREATE POLICY "vessel-docs: read own folder" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'vessel-docs' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "vessel-docs: upload to own folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'vessel-docs' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "vessel-docs: replace in own folder" ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'vessel-docs' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text)
  WITH CHECK (bucket_id = 'vessel-docs' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

CREATE POLICY "vessel-docs: delete from own folder" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'vessel-docs' AND (storage.foldername(name))[1] = (SELECT auth.uid())::text);

-- Guard: roll the whole file back unless the end state is exactly this.
DO $$
DECLARE
  n int;
  p record;
BEGIN
  -- Exactly four vessel-docs policies, one per command, all authenticated-only
  -- and all scoped to the caller's folder.
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%vessel-docs%';
  IF n <> 4 THEN
    RAISE EXCEPTION 'Expected 4 vessel-docs policies, found %. Rolling back.', n;
  END IF;

  FOR p IN
    SELECT policyname, cmd, roles, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'storage' AND tablename = 'objects'
       AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%vessel-docs%'
  LOOP
    IF p.roles <> ARRAY['authenticated']::name[] THEN
      RAISE EXCEPTION 'Policy "%" applies to %, not authenticated only. Rolling back.', p.policyname, p.roles;
    END IF;
    IF p.qual IS NOT NULL AND p.qual NOT LIKE '%foldername%auth.uid()%' THEN
      RAISE EXCEPTION 'Policy "%" USING is not folder-scoped: %. Rolling back.', p.policyname, p.qual;
    END IF;
    IF p.with_check IS NOT NULL AND p.with_check NOT LIKE '%foldername%auth.uid()%' THEN
      RAISE EXCEPTION 'Policy "%" WITH CHECK is not folder-scoped: %. Rolling back.', p.policyname, p.with_check;
    END IF;
  END LOOP;

  SELECT count(DISTINCT cmd) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) LIKE '%vessel-docs%'
     AND cmd IN ('SELECT', 'INSERT', 'UPDATE', 'DELETE');
  IF n <> 4 THEN
    RAISE EXCEPTION 'vessel-docs policies do not cover SELECT/INSERT/UPDATE/DELETE once each. Rolling back.';
  END IF;

  -- No policy on storage.objects that ignores the bucket entirely (it would
  -- open vessel-docs whatever the four above say).
  SELECT count(*) INTO n
    FROM pg_policies
   WHERE schemaname = 'storage' AND tablename = 'objects'
     AND (coalesce(qual, '') || coalesce(with_check, '')) NOT LIKE '%bucket_id%';
  IF n <> 0 THEN
    RAISE EXCEPTION '% storage.objects policy/policies do not check bucket_id. Rolling back.', n;
  END IF;

  IF (SELECT public FROM storage.buckets WHERE id = 'vessel-docs') IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'vessel-docs is not a private bucket. Rolling back.';
  END IF;
END $$;

COMMIT;
