-- Marina operator role-gated access — schema, RPCs, and the owner-change
-- revocation. docs/moxie_digital_marina_access_spec.md (v1, 2026-09-18).
--
--   marinas.join_code        the code on the office poster; resolves to one marina
--   marina_vessel_access     owner → marina grants, one active row per pair
--   grant_marina_access      owner grants (or updates document choices)
--   revoke_marina_access     owner revokes
--   marina_access_revoke_on_owner_change
--                            trigger: any change of vessels.owner_id revokes
--
-- WHY A TRIGGER AND NOT complete_ownership_transfer (spec §9.1, approved).
-- Marina access carries the PREVIOUS owner's contact, emergency contact and
-- documents, so it must not survive a change of owner. owner_id changes in
-- complete_ownership_transfer, in the admin reversal, and in whatever is
-- added later; a trigger on the column covers all of them, and no existing
-- function body is replaced by this file. Nothing here touches
-- complete_ownership_transfer.
--
-- The guard block at the end demonstrates the revocation (and every RPC
-- refusal) inside a subtransaction that is always rolled back, so it writes
-- nothing that survives. owner_id is not a column vessel_identity_audit
-- logs, so the probe produces no audit rows even transiently.
--
-- EXISTING ROWS: none change. One nullable column on marinas (every value
-- NULL until a code is generated), one new empty table, three new functions.
--
-- DEPLOY ORDER: EITHER. The app tolerates the table being absent
-- (PGRST205 / 42P01 read as "no marina has access"). Nothing can grant
-- access until this has run.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- marinas.join_code
-- ─────────────────────────────────────────────────────────────────────────
-- Stored in plain text, unlike the transfer link's token_hash: the code is
-- printed on a poster in a public office, so it is not a secret, and
-- hashing it would only stop us re-printing the poster. What protects an
-- owner is the name preview before they confirm (spec §3.3).
--
-- Alphabet has no 0 O 1 I L. Must match JOIN_CODE_ALPHABET in
-- web/src/lib/marina-access.ts; marina-access.test.mts reads this CHECK
-- and fails if they differ.
ALTER TABLE public.marinas ADD COLUMN IF NOT EXISTS join_code TEXT;

ALTER TABLE public.marinas DROP CONSTRAINT IF EXISTS marinas_join_code_format;
ALTER TABLE public.marinas ADD CONSTRAINT marinas_join_code_format
  CHECK (join_code IS NULL OR join_code ~ '^[2-9A-HJKMNP-Z]{8}$');

CREATE UNIQUE INDEX IF NOT EXISTS marinas_join_code_key
  ON public.marinas (join_code) WHERE join_code IS NOT NULL;

COMMENT ON COLUMN public.marinas.join_code IS
  'Printed on the marina''s office poster; a tenant enters it to grant this marina access to a vessel. Not a secret. Stored without the display hyphen. Regenerating it changes only the code — grants are keyed on marina_id.';

-- ─────────────────────────────────────────────────────────────────────────
-- marina_vessel_access
-- ─────────────────────────────────────────────────────────────────────────
-- Deliberately not a vessel_shares row: no token, no expiry, no view
-- counting, and a field set that is fixed rather than per-share. Only the
-- two document choices vary.
CREATE TABLE IF NOT EXISTS public.marina_vessel_access (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  marina_id          UUID NOT NULL REFERENCES public.marinas(id),
  vessel_id          UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  -- The owner at grant time. Kept after an ownership change, which is the
  -- point of keeping revoked rows: they are the history of who had access.
  granted_by         UUID NOT NULL REFERENCES public.users(id),
  share_registration BOOLEAN NOT NULL,
  share_insurance    BOOLEAN NOT NULL,
  granted_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at         TIMESTAMPTZ,
  revoked_reason     TEXT CHECK (revoked_reason IN ('owner', 'owner_changed')),
  CONSTRAINT marina_vessel_access_revocation_pair
    CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);

-- One active grant per marina–vessel pair. Re-entering a code updates the
-- document choices on that row (ON CONFLICT below) rather than adding one.
CREATE UNIQUE INDEX IF NOT EXISTS marina_vessel_access_active_pair
  ON public.marina_vessel_access (marina_id, vessel_id) WHERE revoked_at IS NULL;

-- The owner-change trigger and the owner's "marinas with access" list look
-- up by vessel.
CREATE INDEX IF NOT EXISTS marina_vessel_access_active_vessel
  ON public.marina_vessel_access (vessel_id) WHERE revoked_at IS NULL;

ALTER TABLE public.marina_vessel_access ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marina_vessel_access FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.marina_vessel_access TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- grant_marina_access
-- ─────────────────────────────────────────────────────────────────────────
-- Refusals, each distinct so each is testable:
--   MX030  the code doesn't resolve to a marina
--   MX031  the caller doesn't own the vessel (or it doesn't exist)
--   MX032  the vessel isn't active — pending payment, dormant or
--          decommissioned. Sharing is suspended while dormant (dormant
--          identity spec §3); an existing grant survives dormancy, a new
--          one can't be made during it.
-- Returns whether this call created the row or updated an active one.
CREATE OR REPLACE FUNCTION public.grant_marina_access(
  p_owner_id           UUID,
  p_vessel_id          UUID,
  p_join_code          TEXT,
  p_share_registration BOOLEAN,
  p_share_insurance    BOOLEAN
)
RETURNS TABLE (access_id UUID, marina_id UUID, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_code      TEXT := upper(regexp_replace(coalesce(p_join_code, ''), '[\s-]', '', 'g'));
  v_marina_id UUID;
  v_vessel    RECORD;
  v_access_id UUID;
  v_created   BOOLEAN;
BEGIN
  -- use_column above: the OUT column marina_id shares its name with the
  -- table column, and every unqualified reference here means the column.
  SELECT m.id INTO v_marina_id FROM marinas m WHERE m.join_code = v_code;
  IF v_marina_id IS NULL THEN
    RAISE EXCEPTION 'No marina has that join code.' USING ERRCODE = 'MX030';
  END IF;

  SELECT v.id, v.owner_id, v.qr_status, v.lifecycle_status
    INTO v_vessel
    FROM vessels v
   WHERE v.id = p_vessel_id
   FOR UPDATE;
  IF NOT FOUND OR v_vessel.owner_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'Only the vessel''s owner can share it with a marina.' USING ERRCODE = 'MX031';
  END IF;
  IF v_vessel.qr_status IS DISTINCT FROM 'active' OR v_vessel.lifecycle_status IS DISTINCT FROM 'active' THEN
    RAISE EXCEPTION 'This vessel is not active, so it can''t be shared.' USING ERRCODE = 'MX032';
  END IF;

  -- The vessel row is locked above, so two grants for the same vessel
  -- serialise here; the partial unique index is the backstop.
  INSERT INTO marina_vessel_access AS a (marina_id, vessel_id, granted_by, share_registration, share_insurance)
  VALUES (v_marina_id, p_vessel_id, p_owner_id, coalesce(p_share_registration, false), coalesce(p_share_insurance, false))
  ON CONFLICT (marina_id, vessel_id) WHERE revoked_at IS NULL
  DO UPDATE SET share_registration = EXCLUDED.share_registration,
                share_insurance    = EXCLUDED.share_insurance,
                updated_at         = now()
  RETURNING a.id, (a.xmax = 0) INTO v_access_id, v_created;

  access_id := v_access_id;
  marina_id := v_marina_id;
  created   := v_created;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_marina_access(UUID, UUID, TEXT, BOOLEAN, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.grant_marina_access(UUID, UUID, TEXT, BOOLEAN, BOOLEAN) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- revoke_marina_access
-- ─────────────────────────────────────────────────────────────────────────
--   MX033  no such grant
--   MX031  the caller doesn't own the vessel it is for
-- Guarded on revoked_at IS NULL: returns true only for the call that
-- actually revoked, false for a repeat. Silent to the marina (spec §2.5).
CREATE OR REPLACE FUNCTION public.revoke_marina_access(p_owner_id UUID, p_access_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id UUID;
BEGIN
  SELECT v.owner_id INTO v_owner_id
    FROM marina_vessel_access a
    JOIN vessels v ON v.id = a.vessel_id
   WHERE a.id = p_access_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such marina access.' USING ERRCODE = 'MX033';
  END IF;
  IF v_owner_id IS DISTINCT FROM p_owner_id THEN
    RAISE EXCEPTION 'Only the vessel''s owner can revoke marina access.' USING ERRCODE = 'MX031';
  END IF;

  UPDATE marina_vessel_access
     SET revoked_at = now(), revoked_reason = 'owner', updated_at = now()
   WHERE id = p_access_id AND revoked_at IS NULL;
  RETURN FOUND;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.revoke_marina_access(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_marina_access(UUID, UUID) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- A change of owner revokes marina access
-- ─────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.marina_access_revoke_on_owner_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE marina_vessel_access
     SET revoked_at = now(), revoked_reason = 'owner_changed', updated_at = now()
   WHERE vessel_id = NEW.id AND revoked_at IS NULL;
  RETURN NULL;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marina_access_revoke_on_owner_change() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marina_access_revoke_on_owner_change() TO service_role;

DROP TRIGGER IF EXISTS marina_access_revoke_on_owner_change ON public.vessels;
CREATE TRIGGER marina_access_revoke_on_owner_change
  AFTER UPDATE OF owner_id ON public.vessels
  FOR EACH ROW
  WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id)
  EXECUTE FUNCTION public.marina_access_revoke_on_owner_change();

-- ─────────────────────────────────────────────────────────────────────────
-- Guard: roll the whole file back unless every claim above is true.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn          TEXT;
  overloads   INTEGER;
  v_vessel    RECORD;
  v_other     UUID;
  v_marina    UUID;
  r           RECORD;
  v_revoked   BOOLEAN;
  v_active    INTEGER;
  refused     BOOLEAN;
  rows_before INTEGER;
  code_before TEXT;
BEGIN
  -- Table, RLS, privileges.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class
     WHERE relname = 'marina_vessel_access' AND relnamespace = 'public'::regnamespace AND relrowsecurity
  ) THEN
    RAISE EXCEPTION 'marina_vessel_access is missing or RLS is off. Rolling back.';
  END IF;
  IF has_table_privilege('anon', 'public.marina_vessel_access', 'SELECT')
     OR has_table_privilege('authenticated', 'public.marina_vessel_access', 'SELECT') THEN
    RAISE EXCEPTION 'anon or authenticated can read marina_vessel_access. Rolling back.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND indexname = 'marina_vessel_access_active_pair'
       AND indexdef ILIKE '%UNIQUE%' AND indexdef ILIKE '%revoked_at IS NULL%'
  ) THEN
    RAISE EXCEPTION 'The partial unique index on active grants is missing. Rolling back.';
  END IF;

  -- Exactly one overload each, not callable by anon/authenticated, callable
  -- by service_role.
  FOREACH fn IN ARRAY ARRAY[
    'public.grant_marina_access(uuid, uuid, text, boolean, boolean)',
    'public.revoke_marina_access(uuid, uuid)',
    'public.marina_access_revoke_on_owner_change()'
  ] LOOP
    SELECT count(*) INTO overloads
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = split_part(split_part(fn, '.', 2), '(', 1);
    IF overloads <> 1 THEN
      RAISE EXCEPTION 'Expected exactly one %, found %. Rolling back.', fn, overloads;
    END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon or authenticated. Rolling back.', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %. Rolling back.', fn;
    END IF;
  END LOOP;

  IF (SELECT format_type(prorettype, NULL) FROM pg_proc WHERE oid = 'public.revoke_marina_access(uuid, uuid)'::regprocedure) <> 'boolean' THEN
    RAISE EXCEPTION 'revoke_marina_access does not return boolean. Rolling back.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.vessels'::regclass
       AND tgname = 'marina_access_revoke_on_owner_change' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The owner-change trigger is missing. Rolling back.';
  END IF;

  -- Demonstrate, don't assert. Everything below runs in a subtransaction
  -- that ends by raising MXZ99, which the handler catches — so every probe
  -- write (a join code, grants, an owner change) is rolled back. Any OTHER
  -- exception is not caught and rolls back the whole file.
  SELECT v.id, v.owner_id INTO v_vessel
    FROM vessels v
   WHERE v.qr_status = 'active' AND v.lifecycle_status = 'active'
   LIMIT 1;
  SELECT u.id INTO v_other FROM users u WHERE u.id IS DISTINCT FROM v_vessel.owner_id LIMIT 1;
  SELECT m.id INTO v_marina FROM marinas m LIMIT 1;

  IF v_vessel.id IS NULL OR v_other IS NULL OR v_marina IS NULL THEN
    RAISE NOTICE 'No active vessel, second user and marina to probe with; behaviour checks skipped.';
  ELSE
    SELECT count(*) INTO rows_before FROM marina_vessel_access;
    SELECT join_code INTO code_before FROM marinas WHERE id = v_marina;

    BEGIN
      UPDATE marinas SET join_code = 'PR0BE222' WHERE id = v_marina;  -- invalid on purpose: has a 0
      RAISE EXCEPTION 'The join_code CHECK accepted a look-alike character. Rolling back.';
    EXCEPTION WHEN check_violation THEN
      NULL;  -- refused, as it should be
    END;

    BEGIN
      UPDATE marinas SET join_code = 'PRBEZZ22' WHERE id = v_marina;

      -- MX030: unknown code.
      refused := false;
      BEGIN
        PERFORM grant_marina_access(v_vessel.owner_id, v_vessel.id, 'ZZZZ-ZZZZ', true, true);
      EXCEPTION WHEN SQLSTATE 'MX030' THEN refused := true;
      END;
      IF NOT refused THEN RAISE EXCEPTION 'An unknown join code was not refused with MX030. Rolling back.'; END IF;

      -- MX031: not the owner.
      refused := false;
      BEGIN
        PERFORM grant_marina_access(v_other, v_vessel.id, 'prbe-zz22', true, true);
      EXCEPTION WHEN SQLSTATE 'MX031' THEN refused := true;
      END;
      IF NOT refused THEN RAISE EXCEPTION 'A non-owner grant was not refused with MX031. Rolling back.'; END IF;

      -- Grant: created; the code is normalised (lower case, hyphen).
      SELECT * INTO r FROM grant_marina_access(v_vessel.owner_id, v_vessel.id, 'prbe-zz22', true, false);
      IF NOT r.created OR r.marina_id IS DISTINCT FROM v_marina THEN
        RAISE EXCEPTION 'First grant did not create a row for the probe marina. Rolling back.';
      END IF;

      -- Re-grant: updates the same row, never a second active one.
      SELECT * INTO r FROM grant_marina_access(v_vessel.owner_id, v_vessel.id, 'PRBEZZ22', false, true);
      SELECT count(*) INTO v_active FROM marina_vessel_access
       WHERE marina_id = v_marina AND vessel_id = v_vessel.id AND revoked_at IS NULL;
      IF r.created OR v_active <> 1 THEN
        RAISE EXCEPTION 'Re-granting created a second active row (% active). Rolling back.', v_active;
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM marina_vessel_access
         WHERE id = r.access_id AND share_registration = false AND share_insurance = true
      ) THEN
        RAISE EXCEPTION 'Re-granting did not update the document choices. Rolling back.';
      END IF;

      -- MX031 on revoke by a non-owner.
      refused := false;
      BEGIN
        PERFORM revoke_marina_access(v_other, r.access_id);
      EXCEPTION WHEN SQLSTATE 'MX031' THEN refused := true;
      END;
      IF NOT refused THEN RAISE EXCEPTION 'A non-owner revoke was not refused with MX031. Rolling back.'; END IF;

      -- The owner change revokes it.
      UPDATE vessels SET owner_id = v_other WHERE id = v_vessel.id;
      IF NOT EXISTS (
        SELECT 1 FROM marina_vessel_access
         WHERE id = r.access_id AND revoked_at IS NOT NULL AND revoked_reason = 'owner_changed'
      ) THEN
        RAISE EXCEPTION 'Changing vessels.owner_id did not revoke marina access. Rolling back.';
      END IF;

      -- An update that doesn't change owner_id must not revoke anything.
      UPDATE vessels SET owner_id = v_vessel.owner_id WHERE id = v_vessel.id;
      SELECT * INTO r FROM grant_marina_access(v_vessel.owner_id, v_vessel.id, 'PRBEZZ22', true, true);
      UPDATE vessels SET owner_id = owner_id, updated_at = updated_at WHERE id = v_vessel.id;
      IF NOT EXISTS (SELECT 1 FROM marina_vessel_access WHERE id = r.access_id AND revoked_at IS NULL) THEN
        RAISE EXCEPTION 'An update that kept the same owner revoked marina access. Rolling back.';
      END IF;

      -- Owner revoke: true once, false after.
      v_revoked := revoke_marina_access(v_vessel.owner_id, r.access_id);
      IF NOT v_revoked THEN RAISE EXCEPTION 'The owner''s revoke did not report a change. Rolling back.'; END IF;
      v_revoked := revoke_marina_access(v_vessel.owner_id, r.access_id);
      IF v_revoked THEN RAISE EXCEPTION 'A repeat revoke reported a change. Rolling back.'; END IF;

      -- MX033: no such grant.
      refused := false;
      BEGIN
        PERFORM revoke_marina_access(v_vessel.owner_id, gen_random_uuid());
      EXCEPTION WHEN SQLSTATE 'MX033' THEN refused := true;
      END;
      IF NOT refused THEN RAISE EXCEPTION 'Revoking a missing grant was not refused with MX033. Rolling back.'; END IF;

      RAISE EXCEPTION 'probe complete' USING ERRCODE = 'MXZ99';
    EXCEPTION WHEN SQLSTATE 'MXZ99' THEN
      NULL;  -- every probe write above is now rolled back
    END;

    IF (SELECT count(*) FROM marina_vessel_access) <> rows_before
       OR (SELECT join_code FROM marinas WHERE id = v_marina) IS DISTINCT FROM code_before
       OR (SELECT owner_id FROM vessels WHERE id = v_vessel.id) IS DISTINCT FROM v_vessel.owner_id THEN
      RAISE EXCEPTION 'A probe write survived its rollback. Rolling back.';
    END IF;
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
