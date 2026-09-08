-- Moxie Digital: private Storage bucket for rendered badge artwork.
--
-- Stage 4 prerequisite. Nothing writes it until the render exists.
--
-- ────────────────────────────────────────────────────────────────────────────
-- PRIVATE, and this is the whole point
--
-- badge_identities has RLS enabled with no policies specifically so that
-- unsold inventory cannot be enumerated (20260921). A rendered badge PNG
-- contains the token in machine-readable form — a public bucket would
-- hand out, as images, exactly the values that table refuses to hand out
-- as rows. Same disclosure, different door.
--
-- Path is badge-artwork/<print_batch_id>/<mxe_id>.png. The batch id is a
-- UUID and unguessable, but the MXE ID inside it is sequential and
-- trivially enumerable, so anyone who learned one batch id could walk
-- every badge in that batch by counting. That is survivable only because
-- the bucket is private: with no SELECT policy, storage.objects denies
-- every anon and authenticated read regardless of whether the path was
-- guessed. Path obscurity is not the control and must not become it.
--
-- The path shape is chosen for the operational job instead: sorted by
-- MXE ID it matches the order a printed sheet is guillotined and the
-- order the fulfilment queue lists, which is what makes a physical shelf
-- workable.
--
-- ────────────────────────────────────────────────────────────────────────────
-- ACCESS: service_role only, served as short-lived signed URLs
--
-- No storage.objects policy is created for this bucket, deliberately —
-- compare 'vessel-photos' (public read) and 'vessel-docs' (owner-scoped
-- policies) in 20260507. Neither model fits: artwork has no owner, since
-- an identity has no owner until signup claims it, and it must not be
-- public. So the only reader is the service-role client behind
-- requireAdmin(), which bypasses RLS by design.
--
-- Admin surfaces render it through createSignedUrl() with a short TTL,
-- the same mechanism the correction-requests page already uses for
-- evidence files. Owners never need it: the owner-facing QR page renders
-- its badge live from buildBadgeSvg() and reads nothing from Storage.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'badge-artwork',
  'badge-artwork',
  false,                      -- PRIVATE. See above; do not flip this.
  5242880,                    -- 5 MB ceiling. A 1800x1800 badge PNG is far under
                              -- this; the limit exists so a bug cannot fill the
                              -- bucket with something enormous.
  ARRAY['image/png']          -- The render writes PNG at 600 DPI (spec §5.1).
)
ON CONFLICT (id) DO NOTHING;

-- Deliberately NO policies on storage.objects for this bucket.

COMMENT ON TABLE storage.buckets IS
  'Supabase Storage buckets. badge-artwork is private with no policies on purpose: a badge PNG carries its scannable token, so public access would expose the inventory that badge_identities RLS exists to protect. Admin reads go through signed URLs on the service-role client.';

-- ────────────────────────────────────────────────────────────────────────────
-- Verify after running:
--
--   SELECT id, public, file_size_limit, allowed_mime_types
--     FROM storage.buckets WHERE id = 'badge-artwork';
--   -- expect: badge-artwork | false | 5242880 | {image/png}
--
--   -- expect ZERO rows: no policy should mention this bucket
--   SELECT policyname FROM pg_policies
--    WHERE schemaname = 'storage' AND tablename = 'objects'
--      AND qual::text LIKE '%badge-artwork%';
-- ────────────────────────────────────────────────────────────────────────────
