-- Marina join codes: a generator, and codes for the existing marinas.
-- docs/moxie_digital_marina_access_spec.md §3. Requires 20261007.
--
--   marina_join_code_candidate()                 one random code; nothing written
--   generate_marina_join_code(marina_id, replace) sets a marina's code, returns it
--
-- A FUNCTION, not hand-written codes: signing up a marina is then one call
-- (and the /admin/marinas page in stage 5 makes the same call), the
-- alphabet lives in one place in SQL, and collisions are handled where the
-- unique index can see them.
--
-- ALPHABET: 23456789ABCDEFGHJKMNPQRSTUVWXYZ — no 0 O 1 I L, the same set
-- the CHECK in 20261007 accepts and JOIN_CODE_ALPHABET in
-- lib/marina-access.ts holds. Randomness comes from gen_random_uuid()
-- (no pgcrypto dependency), using only the 14 of its 16 bytes that are
-- fully random — byte 6 carries the version and byte 8 the variant — with
-- rejection sampling so every character is equally likely.
--
-- COLLISIONS: 31^8 ≈ 850 billion codes, so a collision is vanishingly rare,
-- but it is handled rather than assumed away. The unique index raises
-- unique_violation; the function catches it and draws again, up to 10
-- times, then refuses with MX035 rather than loop forever. The guard below
-- forces a collision to show the retry, and forces ten to show the refusal.
--
-- REPLACE: false returns the marina's existing code untouched, so re-running
-- is safe and never invalidates a printed poster. true draws a new one — the
-- old poster stops working; existing grants are unaffected (keyed on
-- marina_id).
--
-- EXISTING ROWS: sets join_code on every marina that has none (3 today).
-- DEPLOY ORDER: any time after 20261007.

BEGIN;

CREATE OR REPLACE FUNCTION public.marina_join_code_candidate()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet CONSTANT TEXT := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  raw      BYTEA;
  idx      INTEGER;
  b        INTEGER;
  v_code   TEXT := '';
BEGIN
  WHILE length(v_code) < 8 LOOP
    raw := uuid_send(gen_random_uuid());
    FOREACH idx IN ARRAY ARRAY[0, 1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 15] LOOP
      b := get_byte(raw, idx);
      CONTINUE WHEN b >= 248;  -- 248 = 8 × 31; above it, b % 31 would favour the first 8 characters
      v_code := v_code || substr(alphabet, (b % 31) + 1, 1);
      EXIT WHEN length(v_code) = 8;
    END LOOP;
  END LOOP;
  RETURN v_code;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.marina_join_code_candidate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marina_join_code_candidate() TO service_role;

-- MX034  no such marina
-- MX035  ten draws in a row collided (should never happen; refuses rather than loops)
CREATE OR REPLACE FUNCTION public.generate_marina_join_code(p_marina_id UUID, p_replace BOOLEAN)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing TEXT;
  v_code     TEXT;
  attempt    INTEGER;
BEGIN
  SELECT m.join_code INTO v_existing FROM marinas m WHERE m.id = p_marina_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No such marina.' USING ERRCODE = 'MX034';
  END IF;
  IF v_existing IS NOT NULL AND NOT coalesce(p_replace, false) THEN
    RETURN v_existing;
  END IF;

  FOR attempt IN 1..10 LOOP
    v_code := marina_join_code_candidate();
    BEGIN
      UPDATE marinas SET join_code = v_code WHERE id = p_marina_id;
      RETURN v_code;
    EXCEPTION WHEN unique_violation THEN
      NULL;  -- another marina holds this code; draw again
    END;
  END LOOP;
  RAISE EXCEPTION 'Could not find an unused join code in 10 draws.' USING ERRCODE = 'MX035';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.generate_marina_join_code(UUID, BOOLEAN) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_marina_join_code(UUID, BOOLEAN) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn       TEXT;
  n        INTEGER;
  code     TEXT;
  code2    TEXT;
  m_a      UUID;
  m_b      UUID;
  refused  BOOLEAN;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.marina_join_code_candidate()',
    'public.generate_marina_join_code(uuid, boolean)'
  ] LOOP
    SELECT count(*) INTO n FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
     WHERE ns.nspname = 'public' AND p.proname = split_part(split_part(fn, '.', 2), '(', 1);
    IF n <> 1 THEN RAISE EXCEPTION 'Expected exactly one %, found %. Rolling back.', fn, n; END IF;
    IF has_function_privilege('anon', fn, 'EXECUTE') OR has_function_privilege('authenticated', fn, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon or authenticated. Rolling back.', fn;
    END IF;
    IF NOT has_function_privilege('service_role', fn, 'EXECUTE') THEN
      RAISE EXCEPTION 'service_role cannot execute %. Rolling back.', fn;
    END IF;
  END LOOP;

  -- 2,000 draws: every one passes the CHECK's pattern, and every character
  -- of the alphabet turns up (a skipped character would show here). This
  -- does NOT detect a small bias — that is what the rejection step above is
  -- for, and no sample this size would reliably see it.
  SELECT count(*) INTO n FROM generate_series(1, 2000) g
   WHERE marina_join_code_candidate() !~ '^[2-9A-HJKMNP-Z]{8}$';
  IF n > 0 THEN RAISE EXCEPTION '% generated codes fail the CHECK pattern. Rolling back.', n; END IF;
  -- The call sits in a select list so it runs once per row; in FROM it
  -- would run once in total.
  SELECT count(DISTINCT ch) INTO n
    FROM (SELECT marina_join_code_candidate() AS c FROM generate_series(1, 2000)) draws,
         regexp_split_to_table(draws.c, '') ch;
  IF n <> 31 THEN RAISE EXCEPTION 'Generated codes used % of 31 characters. Rolling back.', n; END IF;

  -- Behaviour, in a subtransaction that is always rolled back (MXZ99).
  SELECT id INTO m_a FROM marinas ORDER BY id LIMIT 1;
  SELECT id INTO m_b FROM marinas ORDER BY id OFFSET 1 LIMIT 1;
  IF m_b IS NULL THEN
    RAISE NOTICE 'Fewer than two marinas; collision checks skipped.';
  ELSE
    BEGIN
      -- replace=false is idempotent; replace=true draws a new code.
      code := generate_marina_join_code(m_a, true);
      IF generate_marina_join_code(m_a, false) IS DISTINCT FROM code THEN
        RAISE EXCEPTION 'replace=false changed an existing code. Rolling back.';
      END IF;

      -- Force a collision: the first draw returns m_a's code, the second a fresh one.
      CREATE TEMP SEQUENCE marina_probe_draw;
      EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public.marina_join_code_candidate() RETURNS TEXT LANGUAGE sql VOLATILE AS
        $b$ SELECT CASE WHEN nextval('pg_temp.marina_probe_draw') = 1 THEN %L ELSE 'ZZZZ2222' END $b$
      $f$, code);
      code2 := generate_marina_join_code(m_b, true);
      IF code2 IS DISTINCT FROM 'ZZZZ2222' THEN
        RAISE EXCEPTION 'A colliding draw was not retried (got %). Rolling back.', code2;
      END IF;

      -- Force ten collisions: refused with MX035, and m_b keeps its code.
      EXECUTE format($f$
        CREATE OR REPLACE FUNCTION public.marina_join_code_candidate() RETURNS TEXT LANGUAGE sql VOLATILE AS
        $b$ SELECT %L::text $b$
      $f$, code);
      refused := false;
      BEGIN
        PERFORM generate_marina_join_code(m_b, true);
      EXCEPTION WHEN SQLSTATE 'MX035' THEN refused := true;
      END;
      IF NOT refused THEN RAISE EXCEPTION 'Ten collisions were not refused with MX035. Rolling back.'; END IF;
      IF (SELECT join_code FROM marinas WHERE id = m_b) IS DISTINCT FROM 'ZZZZ2222' THEN
        RAISE EXCEPTION 'A refused regeneration changed the code. Rolling back.';
      END IF;

      refused := false;
      BEGIN
        PERFORM generate_marina_join_code(gen_random_uuid(), true);
      EXCEPTION WHEN SQLSTATE 'MX034' THEN refused := true;
      END;
      IF NOT refused THEN RAISE EXCEPTION 'An unknown marina was not refused with MX034. Rolling back.'; END IF;

      RAISE EXCEPTION 'probe complete' USING ERRCODE = 'MXZ99';
    EXCEPTION WHEN SQLSTATE 'MXZ99' THEN
      NULL;  -- probe codes and the stand-in generator are rolled back
    END;

    -- The real generator is back.
    IF marina_join_code_candidate() IN ('ZZZZ2222', code) THEN
      RAISE EXCEPTION 'The stand-in generator survived the rollback. Rolling back.';
    END IF;
  END IF;
END $$;

-- Codes for every marina that has none. replace=false, so a re-run
-- leaves existing codes (and printed posters) alone.
SELECT generate_marina_join_code(id, false) FROM marinas WHERE join_code IS NULL;

COMMIT;

NOTIFY pgrst, 'reload schema';

-- What to enter, as it will be printed.
SELECT name, city, substr(join_code, 1, 4) || '-' || substr(join_code, 5) AS join_code
  FROM marinas
 ORDER BY name;

-- ─────────────────────────────────────────────────────────────────────────
-- OPTIONAL, not part of this migration: a fixture marina for testing, so
-- test grants (and their permanent revoked rows) don't sit in a real
-- business's history. Uncomment and run separately if wanted.
-- ─────────────────────────────────────────────────────────────────────────
-- INSERT INTO marinas (name, city, state, region)
--   VALUES ('Moxie Test Marina', 'Oakland', 'CA', 'Fixture — not a real marina')
--   RETURNING id, name, generate_marina_join_code(id, false) AS join_code;
