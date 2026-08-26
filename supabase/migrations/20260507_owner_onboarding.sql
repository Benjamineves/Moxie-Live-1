-- Moxie Lite owner onboarding: storage + vessel docs + MXE id generator

INSERT INTO storage.buckets (id, name, public)
VALUES ('vessel-photos', 'vessel-photos', true)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('vessel-docs', 'vessel-docs', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read vessel photos" ON storage.objects;
CREATE POLICY "Public read vessel photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'vessel-photos');

DROP POLICY IF EXISTS "Owner upload vessel photos" ON storage.objects;
CREATE POLICY "Owner upload vessel photos" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'vessel-photos' AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Owner read vessel docs" ON storage.objects;
CREATE POLICY "Owner read vessel docs" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Owner upload vessel docs" ON storage.objects;
CREATE POLICY "Owner upload vessel docs" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'vessel-docs' AND auth.uid() IS NOT NULL
  );

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_registration_url TEXT;
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS doc_insurance_url TEXT;

CREATE OR REPLACE FUNCTION public.next_mxe_id()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  last_mxe TEXT;
  next_num INTEGER;
BEGIN
  PERFORM pg_advisory_lock(hashtext('mxe_id_sequence_lock'));

  SELECT mxe_id
  INTO last_mxe
  FROM vessels
  WHERE mxe_id ~ '^MXE-[0-9]{5}$'
  ORDER BY mxe_id DESC
  LIMIT 1;

  IF last_mxe IS NULL THEN
    next_num := 1;
  ELSE
    next_num := CAST(right(last_mxe, 5) AS INTEGER) + 1;
  END IF;

  PERFORM pg_advisory_unlock(hashtext('mxe_id_sequence_lock'));
  RETURN 'MXE-' || lpad(next_num::TEXT, 5, '0');
EXCEPTION
  WHEN OTHERS THEN
    PERFORM pg_advisory_unlock(hashtext('mxe_id_sequence_lock'));
    RAISE;
END;
$$;
