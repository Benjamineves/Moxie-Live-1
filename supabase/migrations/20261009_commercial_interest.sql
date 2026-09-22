-- Commercial / broker interest capture, replacing the mailto: button on
-- /pricing. docs/moxie_digital_broker_role_spec.md is the feature this
-- list is waiting for.
--
--   commercial_interest           one row per email, updated on re-submit
--   commercial_interest_attempts  per-IP attempts, for the rate limit
--   record_commercial_interest    the only way in; validates, limits, upserts
--
-- WHY AN RPC RATHER THAN AN INSERT FROM THE ACTION. This is an
-- unauthenticated form that writes to the database and triggers an email,
-- so every check that can live in SQL does: the email shape, the business
-- type, and the rate limit. A check in the server action would be a check
-- one caller makes (CLAUDE.md, "Enforcement lives in the function").
--
-- Refusals, each with its own SQLSTATE so each is testable:
--   MX040  the email isn't one
--   MX041  business_type outside the fixed list
--   MX042  too many attempts from this IP
--
-- RATE LIMIT: 5 per IP per hour, 20 per day. A broker filling this in for
-- two colleagues is fine; a script is not. Blocked attempts are NOT
-- recorded — RAISE rolls back the attempt row with everything else — so a
-- blocked IP's window empties on its own rather than extending forever.
--
-- IP is stored HASHED and never in the clear: it is here to stop abuse,
-- not to identify anyone. sha256 of an IPv4 address is brute-forceable by
-- anyone holding the table, which is why the table is service-role only.
--
-- EXISTING ROWS: none — two new tables.
-- DEPLOY ORDER: BEFORE the deploy. The form's action needs the RPC; until
-- it exists the page keeps rendering, and a submission reports a failure
-- rather than silently dropping someone who wants to be on the list.

BEGIN;

CREATE TABLE IF NOT EXISTS public.commercial_interest (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Lower-cased by the RPC, so re-submitting "Ben@X" updates "ben@x".
  email         TEXT NOT NULL UNIQUE,
  -- Optional on purpose: every field costs signups. NULL means "didn't say".
  business_type TEXT CHECK (business_type IS NULL OR business_type IN ('broker', 'dealer', 'charter', 'other')),
  source_page   TEXT NOT NULL,
  ip_hash       TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.commercial_interest IS
  'People who asked to be told when the commercial/broker tier opens. The point of the list is one email, later — see /admin/commercial-interest for the export.';
COMMENT ON COLUMN public.commercial_interest.submitted_at IS
  'First submission. Re-submitting updates the row and moves updated_at, never this.';

CREATE INDEX IF NOT EXISTS commercial_interest_newest ON public.commercial_interest (submitted_at DESC);

CREATE TABLE IF NOT EXISTS public.commercial_interest_attempts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ip_hash      TEXT NOT NULL,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS commercial_interest_attempts_ip ON public.commercial_interest_attempts (ip_hash, attempted_at DESC);

ALTER TABLE public.commercial_interest ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_interest_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.commercial_interest FROM anon, authenticated;
REVOKE ALL ON public.commercial_interest_attempts FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.commercial_interest TO service_role;
GRANT SELECT, INSERT, DELETE ON public.commercial_interest_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.record_commercial_interest(
  p_email         TEXT,
  p_business_type TEXT,
  p_source_page   TEXT,
  p_ip_hash       TEXT
)
RETURNS TABLE (interest_id UUID, created BOOLEAN)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
#variable_conflict use_column
DECLARE
  v_email  TEXT := lower(btrim(coalesce(p_email, '')));
  v_type   TEXT := nullif(btrim(coalesce(p_business_type, '')), '');
  v_recent INTEGER;
  v_id     UUID;
  v_new    BOOLEAN;
BEGIN
  -- Deliberately loose: one @, something either side, no spaces. Anything
  -- stricter rejects real addresses, and the email either reaches them or
  -- it doesn't.
  IF v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' OR length(v_email) > 320 THEN
    RAISE EXCEPTION 'That does not look like an email address.' USING ERRCODE = 'MX040';
  END IF;
  IF v_type IS NOT NULL AND v_type NOT IN ('broker', 'dealer', 'charter', 'other') THEN
    RAISE EXCEPTION 'Unknown business type.' USING ERRCODE = 'MX041';
  END IF;

  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*) INTO v_recent
      FROM commercial_interest_attempts
     WHERE ip_hash = p_ip_hash AND attempted_at > now() - INTERVAL '1 hour';
    IF v_recent >= 5 THEN
      RAISE EXCEPTION 'Too many submissions from this connection. Try again later.' USING ERRCODE = 'MX042';
    END IF;

    SELECT count(*) INTO v_recent
      FROM commercial_interest_attempts
     WHERE ip_hash = p_ip_hash AND attempted_at > now() - INTERVAL '24 hours';
    IF v_recent >= 20 THEN
      RAISE EXCEPTION 'Too many submissions from this connection. Try again later.' USING ERRCODE = 'MX042';
    END IF;

    INSERT INTO commercial_interest_attempts (ip_hash) VALUES (p_ip_hash);
  END IF;

  INSERT INTO commercial_interest AS ci (email, business_type, source_page, ip_hash)
  VALUES (v_email, v_type, coalesce(nullif(btrim(coalesce(p_source_page, '')), ''), '/pricing'), p_ip_hash)
  ON CONFLICT (email) DO UPDATE
    SET business_type = coalesce(EXCLUDED.business_type, ci.business_type),
        source_page   = EXCLUDED.source_page,
        ip_hash       = coalesce(EXCLUDED.ip_hash, ci.ip_hash),
        updated_at    = now()
  RETURNING ci.id, (ci.xmax = 0) INTO v_id, v_new;

  interest_id := v_id;
  created := v_new;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_commercial_interest(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_commercial_interest(TEXT, TEXT, TEXT, TEXT) TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard: roll the whole file back unless every claim above is true.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  fn        TEXT;
  overloads INTEGER;
  r         RECORD;
  refused   BOOLEAN;
  n         INTEGER;
BEGIN
  FOREACH fn IN ARRAY ARRAY['public.commercial_interest', 'public.commercial_interest_attempts'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_class WHERE oid = fn::regclass AND relrowsecurity
    ) THEN
      RAISE EXCEPTION '% is missing or RLS is off. Rolling back.', fn;
    END IF;
    IF has_table_privilege('anon', fn, 'SELECT') OR has_table_privilege('authenticated', fn, 'SELECT') THEN
      RAISE EXCEPTION 'anon or authenticated can read %. Rolling back.', fn;
    END IF;
  END LOOP;

  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.proname = 'record_commercial_interest';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one record_commercial_interest, found %. Rolling back.', overloads;
  END IF;
  IF has_function_privilege('anon', 'public.record_commercial_interest(text, text, text, text)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.record_commercial_interest(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'record_commercial_interest is executable by anon or authenticated. Rolling back.';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.record_commercial_interest(text, text, text, text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role cannot execute record_commercial_interest. Rolling back.';
  END IF;

  -- Demonstrate, don't assert. Everything below is rolled back by MXZ99.
  BEGIN
    refused := false;
    BEGIN
      PERFORM record_commercial_interest('not-an-email', NULL, '/pricing', 'probe');
    EXCEPTION WHEN SQLSTATE 'MX040' THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'A malformed email was accepted. Rolling back.'; END IF;

    refused := false;
    BEGIN
      PERFORM record_commercial_interest('probe@example.test', 'yacht-whisperer', '/pricing', 'probe');
    EXCEPTION WHEN SQLSTATE 'MX041' THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'An unknown business type was accepted. Rolling back.'; END IF;

    -- First submission creates; the same address updates in place.
    SELECT * INTO r FROM record_commercial_interest('  Probe@Example.test ', 'broker', '/pricing', 'probe-upsert');
    IF NOT r.created THEN RAISE EXCEPTION 'First submission did not create a row. Rolling back.'; END IF;
    SELECT * INTO r FROM record_commercial_interest('probe@example.test', NULL, '/pricing', 'probe-upsert');
    IF r.created IS DISTINCT FROM false OR r.interest_id IS NULL THEN
      RAISE EXCEPTION 'Re-submitting did not report an update of one existing row (created=%, id=%). Rolling back.', r.created, r.interest_id;
    END IF;
    SELECT count(*) INTO n FROM commercial_interest WHERE email = 'probe@example.test';
    IF n <> 1 THEN RAISE EXCEPTION 'Expected one row per email, found %. Rolling back.', n; END IF;
    -- An omitted business type must not erase the one already given.
    IF (SELECT business_type FROM commercial_interest WHERE email = 'probe@example.test') IS DISTINCT FROM 'broker' THEN
      RAISE EXCEPTION 'Re-submitting without a business type erased it. Rolling back.';
    END IF;
    -- A re-submit that DOES name a business type replaces the old one, which
    -- is how this guard knows the DO UPDATE branch ran at all.
    SELECT * INTO r FROM record_commercial_interest('probe@example.test', 'charter', '/pricing', 'probe-upsert');
    IF r.created IS DISTINCT FROM false THEN RAISE EXCEPTION 'Third submission created a row. Rolling back.'; END IF;
    IF (SELECT business_type FROM commercial_interest WHERE email = 'probe@example.test') IS DISTINCT FROM 'charter' THEN
      RAISE EXCEPTION 'Re-submitting did not update the business type. Rolling back.';
    END IF;

    -- Five an hour from one connection, and the sixth is refused.
    FOR n IN 1..5 LOOP
      PERFORM record_commercial_interest(format('probe-rate-%s@example.test', n), NULL, '/pricing', 'probe-rate');
    END LOOP;
    refused := false;
    BEGIN
      PERFORM record_commercial_interest('probe6@example.test', NULL, '/pricing', 'probe-rate');
    EXCEPTION WHEN SQLSTATE 'MX042' THEN refused := true;
    END;
    IF NOT refused THEN RAISE EXCEPTION 'The sixth submission in an hour was not refused. Rolling back.'; END IF;

    -- A different connection is unaffected by that IP's limit.
    SELECT * INTO r FROM record_commercial_interest('elsewhere@example.test', NULL, '/pricing', 'other-probe');
    IF NOT r.created THEN RAISE EXCEPTION 'A different IP was caught by another IP''s limit. Rolling back.'; END IF;

    RAISE EXCEPTION 'probe complete' USING ERRCODE = 'MXZ99';
  EXCEPTION WHEN SQLSTATE 'MXZ99' THEN
    NULL;  -- every probe row above is rolled back
  END;

  IF EXISTS (SELECT 1 FROM commercial_interest) OR EXISTS (SELECT 1 FROM commercial_interest_attempts) THEN
    RAISE EXCEPTION 'A probe row survived its rollback. Rolling back.';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
