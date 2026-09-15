-- Scheduler, phase 1: the tables the daily cron records itself in, and the
-- columns its later steps read. docs/moxie_digital_scheduler_spec.md §9.
--
-- Phase 1 is REPORT-ONLY. The job reads accounts, vessels and Stripe and
-- writes nothing but its own bookkeeping (scheduler_runs, scheduler_events,
-- scheduler_account_checks). The columns and expiry_reminder_sends are
-- created now so the report reads real (empty) state rather than guessing;
-- nothing writes them until a step is switched on.
--
--   scheduler_runs            one row per run; a partial unique index lets
--                             only one run hold status 'running' (the lease)
--   scheduler_events          one row per thing a run found or did.
--                             APPEND-ONLY: a trigger refuses UPDATE and
--                             DELETE for every role, and UPDATE/DELETE/
--                             TRUNCATE are revoked from the API roles
--   scheduler_account_checks  when each account last finished the
--                             pipeline, so a run cut short resumes with the
--                             accounts it didn't reach
--   expiry_reminder_sends     reminder claims, unique per vessel, owner,
--                             document, expiry date and threshold
--   users.no_plan_since               the 30-day no-plan window's clock
--   users.expiry_reminders_opt_out_at null = reminders on
--
-- EXISTING ROWS: none change. Two nullable columns are added to users, null
-- for everyone.
--
-- ACCESS: RLS on, no policies, and anon/authenticated privileges revoked on
-- all four tables — service role only. The one new function is a trigger
-- function; it gets the same EXECUTE lockdown as every other function
-- (CLAUDE.md), and the guard below checks it.
--
-- DEPLOY ORDER: either. Before this runs, the cron route returns 500
-- ("migration 20261004 not run") and the health endpoint returns 503; no
-- other code reads these objects.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- scheduler_runs
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduler_runs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trigger      TEXT NOT NULL CHECK (trigger IN ('cron', 'manual')),
  status       TEXT NOT NULL DEFAULT 'running'
               CHECK (status IN ('running', 'succeeded', 'partial', 'failed', 'timed_out')),
  -- Which steps were acting and which report-only, as the run saw its config.
  modes        JSONB NOT NULL,
  started_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at  TIMESTAMPTZ,
  -- Per-step counts, breaker measurements, accounts not reached.
  summary      JSONB,
  error        TEXT,
  -- Whether this run warrants an admin digest, and whether it was sent.
  needs_alert  BOOLEAN NOT NULL DEFAULT false,
  alerted_at   TIMESTAMPTZ
);

-- The lease: a second concurrent run's insert fails with 23505.
CREATE UNIQUE INDEX IF NOT EXISTS scheduler_runs_one_running
  ON public.scheduler_runs ((true)) WHERE status = 'running';

CREATE INDEX IF NOT EXISTS scheduler_runs_finished
  ON public.scheduler_runs (finished_at DESC) WHERE finished_at IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- scheduler_events — append-only
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduler_events (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES public.scheduler_runs(id) ON DELETE RESTRICT,
  owner_id    UUID,
  vessel_id   UUID,
  step        TEXT NOT NULL CHECK (step IN ('run', 'tier', 'no_plan_window', 'dormancy', 'reminders')),
  kind        TEXT NOT NULL CHECK (kind IN ('changed', 'would_change', 'exempt', 'skipped', 'failed', 'anomaly')),
  -- Stable description of the finding, compared across runs (the two-run
  -- rule for downward corrections). e.g. 'tier:full->basic'.
  signature   TEXT,
  detail      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS scheduler_events_run ON public.scheduler_events (run_id);
CREATE INDEX IF NOT EXISTS scheduler_events_owner_step ON public.scheduler_events (owner_id, step, created_at DESC);

CREATE OR REPLACE FUNCTION public.scheduler_events_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'scheduler_events is append-only: % refused', TG_OP;
END;
$$;

DROP TRIGGER IF EXISTS scheduler_events_no_update_delete ON public.scheduler_events;
CREATE TRIGGER scheduler_events_no_update_delete
  BEFORE UPDATE OR DELETE ON public.scheduler_events
  FOR EACH ROW EXECUTE FUNCTION public.scheduler_events_append_only();

-- ─────────────────────────────────────────────────────────────────────────
-- scheduler_account_checks
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.scheduler_account_checks (
  owner_id     UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  checked_at   TIMESTAMPTZ NOT NULL,
  run_id       UUID REFERENCES public.scheduler_runs(id) ON DELETE SET NULL
);

-- ─────────────────────────────────────────────────────────────────────────
-- expiry_reminder_sends
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.expiry_reminder_sends (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id       UUID NOT NULL REFERENCES public.vessels(id) ON DELETE CASCADE,
  owner_id        UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  doc_type        TEXT NOT NULL CHECK (doc_type IN ('registration', 'insurance', 'fishing_license')),
  expiry_date     DATE NOT NULL,
  threshold_days  INTEGER NOT NULL CHECK (threshold_days IN (30, 7, 0)),
  status          TEXT NOT NULL DEFAULT 'claimed' CHECK (status IN ('claimed', 'sent', 'failed')),
  resend_id       TEXT,
  run_id          UUID REFERENCES public.scheduler_runs(id) ON DELETE SET NULL,
  claimed_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at         TIMESTAMPTZ,
  CONSTRAINT expiry_reminder_sends_once
    UNIQUE (vessel_id, owner_id, doc_type, expiry_date, threshold_days)
);

-- ─────────────────────────────────────────────────────────────────────────
-- users
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS no_plan_since TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS expiry_reminders_opt_out_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.no_plan_since IS
  'Scheduler: when a run first saw this account holding an active vessel with no live plan. The 30-day window runs from here. Null = no clock.';
COMMENT ON COLUMN public.users.expiry_reminders_opt_out_at IS
  'When the owner turned document expiry reminder emails off. Null = on.';

-- ─────────────────────────────────────────────────────────────────────────
-- Access
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE public.scheduler_runs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_events          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduler_account_checks  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expiry_reminder_sends     ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.scheduler_runs            FROM anon, authenticated;
REVOKE ALL ON public.scheduler_events          FROM anon, authenticated;
REVOKE ALL ON public.scheduler_account_checks  FROM anon, authenticated;
REVOKE ALL ON public.expiry_reminder_sends     FROM anon, authenticated;

REVOKE UPDATE, DELETE, TRUNCATE ON public.scheduler_events FROM service_role;

REVOKE EXECUTE ON FUNCTION public.scheduler_events_append_only() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.scheduler_events_append_only() TO service_role;

-- ─────────────────────────────────────────────────────────────────────────
-- Guard.
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  t          TEXT;
  overloads  INTEGER;
BEGIN
  FOREACH t IN ARRAY ARRAY['scheduler_runs', 'scheduler_events', 'scheduler_account_checks', 'expiry_reminder_sends'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION 'public.% was not created. Rolling back.', t;
    END IF;
    IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass('public.' || t)) THEN
      RAISE EXCEPTION 'RLS is not enabled on public.%. Rolling back.', t;
    END IF;
    IF has_table_privilege('anon', 'public.' || t, 'SELECT')
       OR has_table_privilege('authenticated', 'public.' || t, 'SELECT') THEN
      RAISE EXCEPTION 'public.% is readable by anon or authenticated. Rolling back.', t;
    END IF;
  END LOOP;

  IF has_table_privilege('service_role', 'public.scheduler_events', 'UPDATE')
     OR has_table_privilege('service_role', 'public.scheduler_events', 'DELETE') THEN
    RAISE EXCEPTION 'service_role can still UPDATE or DELETE scheduler_events. Rolling back.';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.scheduler_events', 'INSERT') THEN
    RAISE EXCEPTION 'service_role cannot INSERT into scheduler_events. Rolling back.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.scheduler_events'::regclass
       AND tgname = 'scheduler_events_no_update_delete' AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'The append-only trigger on scheduler_events is missing. Rolling back.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'scheduler_runs_one_running'
  ) THEN
    RAISE EXCEPTION 'The scheduler_runs lease index is missing. Rolling back.';
  END IF;

  SELECT count(*) INTO overloads
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'scheduler_events_append_only';
  IF overloads <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one scheduler_events_append_only, found %. Rolling back.', overloads;
  END IF;
  IF has_function_privilege('anon', 'public.scheduler_events_append_only()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.scheduler_events_append_only()', 'EXECUTE') THEN
    RAISE EXCEPTION 'scheduler_events_append_only is executable by anon or authenticated. Rolling back.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'no_plan_since')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'expiry_reminders_opt_out_at') THEN
    RAISE EXCEPTION 'users columns were not added. Rolling back.';
  END IF;
END $$;

COMMIT;

NOTIFY pgrst, 'reload schema';
