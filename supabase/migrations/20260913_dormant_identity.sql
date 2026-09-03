-- Moxie Digital: Dormant Vessel Identity
-- docs/moxie_digital_dormant_identity_spec.md
--
-- Unifies three previously-separate situations — a lapsed subscription,
-- downgrade overflow beyond Basic's vessel cap, and (already built)
-- decommission — into one concept: the vessel has permanent identity but
-- isn't actively managed. The three causes stay distinct in storage
-- (different reversal paths, different admin semantics); they resolve
-- to one shared effect via lifecycle_status + dormant_cause, read by one
-- shared place in the app (getDormantInfo(), lib/vessel-dormancy.ts).
--
-- Does NOT build §6's new-owner claim path — flagged in the spec itself
-- as needing separate design; a dormant vessel's public page invites a
-- prospective owner to get in touch, not to self-serve claim it.

-- ────────────────────────────────────────────────────────────────────────────
-- lifecycle_status gains a third value: 'dormant', alongside the existing
-- 'active' | 'decommissioned' (20260906_vessel_decommission.sql). No
-- CHECK constraint exists on this column (never did), so this is a
-- documentation-only change at the schema level — but it's the whole
-- mechanism for composing with the vessel cap: every place that already
-- filters lifecycle_status = 'active' for the cap (createVessel,
-- reactivate_vessel, accept_ownership_transfer, reverse_ownership_transfer)
-- automatically excludes dormant vessels with ZERO changes to any of
-- them, the same way 'decommissioned' already does. Don't add a
-- separate is_dormant boolean anywhere that cap logic would need to
-- additionally check — that would be exactly the "third parallel
-- condition" the spec's §7.3 warns against.
--
-- dormant_cause narrows 'dormant' specifically: 'lapsed' | 'locked'.
-- 'decommissioned' doesn't need a cause column — lifecycle_status itself
-- already says what it is.
-- ────────────────────────────────────────────────────────────────────────────

COMMENT ON COLUMN vessels.lifecycle_status IS
  'Fleet-membership status, independent of qr_status (badge activation). ''active'' | ''decommissioned'' | ''dormant''. Never deleted -- a status change only. See dormant_cause for which of the two dormant causes applies.';

ALTER TABLE vessels ADD COLUMN IF NOT EXISTS dormant_cause TEXT;  -- 'lapsed' | 'locked', only meaningful when lifecycle_status='dormant'
ALTER TABLE vessels ADD COLUMN IF NOT EXISTS dormant_since TIMESTAMPTZ;

COMMENT ON COLUMN vessels.dormant_cause IS
  'Which of the two non-decommission dormant causes applies -- ''lapsed'' (owner''s subscription lapsed) | ''locked'' (Basic-tier vessel-cap overflow after a downgrade). NULL unless lifecycle_status=''dormant''.';

CREATE INDEX IF NOT EXISTS idx_vessels_dormant_cause ON vessels(dormant_cause) WHERE dormant_cause IS NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────
-- users: two new timestamps driving the two lazy grace-period checks.
-- Both are check-on-read, not cron-driven -- this app has no scheduled-
-- job infrastructure, so "has the grace period elapsed" is evaluated
-- opportunistically wherever a relevant page loads (the owner's own
-- dashboard, the public page for one of their vessels, and -- to keep
-- admin-facing counts from drifting indefinitely for an owner who never
-- logs back in -- every /admin page load too, via reconcile_all_dormancy()
-- below).
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS past_due_since TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS downgrade_grace_until TIMESTAMPTZ;

COMMENT ON COLUMN users.past_due_since IS
  'When subscription_status first became ''past_due'' (cleared on recovery or on lapsing to dormant). Grace period (PAST_DUE_GRACE_DAYS, lib/tier-config.ts, mirrored below) is measured from this.';
COMMENT ON COLUMN users.downgrade_grace_until IS
  'Set when a Basic-tier account is found holding more active vessels than its cap allows (a downgrade, or resubscribing to Basic after being Full). Nothing locks until this passes -- the owner has this long to choose which vessels stay active. Cleared once resolved (owner chooses, fallback applies, or overflow no longer exists).';

-- ────────────────────────────────────────────────────────────────────────────
-- owner_notifications -- the one notification hook's storage.
--
-- With no email provider chosen yet, every dormancy notification in the
-- app funnels through the single notifyOwner() function
-- (lib/notify.ts), which today just inserts a row here; a banner on
-- /dashboard reads unread rows for the signed-in owner. Adding email
-- later is one change inside that one function -- no call site changes.
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS owner_notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id   UUID NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL,
  vessel_id  UUID REFERENCES vessels(id),
  message    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_owner_notifications_owner_unread
  ON owner_notifications(owner_id) WHERE read_at IS NULL;

ALTER TABLE owner_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Owners read own notifications" ON owner_notifications;
CREATE POLICY "Owners read own notifications" ON owner_notifications
  FOR SELECT USING (owner_id = auth.uid());

COMMENT ON TABLE owner_notifications IS
  'Backing store for the one notification hook (lib/notify.ts notifyOwner()) -- in-app banners today, email later without touching call sites.';

-- ────────────────────────────────────────────────────────────────────────────
-- set_vessels_lapsed / clear_vessels_lapsed
--
-- 'canceled'/'unpaid' from Stripe means dunning is already exhausted --
-- no additional grace on top of Stripe's own, so this is called
-- immediately from the webhook for those statuses. 'past_due' does NOT
-- call this directly -- see apply_past_due_dormancy_if_expired below for
-- the graced version.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION set_vessels_lapsed(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'lapsed', dormant_since = now()
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  -- Spec §3: "Trusted Contact Sharing (existing active shares revoked;
  -- no new ones)" -- same revocation apply_vessel_decommission already
  -- does, applied here for the same reason.
  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed'
      );
END;
$$;

-- Restores every lapsed-dormant vessel, then hands off to overflow
-- reconciliation -- resubscribing to Basic after having been Full (or
-- after accumulating vessels while lapsed) can itself create overflow,
-- which must go through the same grace-window treatment as a genuine
-- downgrade, not an instant re-lock.
CREATE OR REPLACE FUNCTION clear_vessels_lapsed(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  UPDATE vessels
    SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
    WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'lapsed';

  UPDATE users SET past_due_since = NULL WHERE id = p_owner_id;

  PERFORM reconcile_vessel_overflow(p_owner_id);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- apply_past_due_dormancy_if_expired -- the lazy, per-owner past-due check.
--
-- PAST_DUE_GRACE_DAYS = 7, mirrored from lib/tier-config.ts (SQL can't
-- read that file -- keep both in sync by hand, same trade-off already
-- accepted for vessel_limit_for_tier). Reasoning for 7 lives in the
-- build plan this shipped from: Stripe's own Smart Retry schedule makes
-- its first several attempts within about a week, so 7 days covers a
-- transient card problem without leaving a vessel with a genuinely dead
-- card fully accessible for weeks.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION apply_past_due_dormancy_if_expired(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  u RECORD;
BEGIN
  SELECT subscription_status, past_due_since INTO u FROM users WHERE id = p_owner_id;

  IF u.subscription_status IS DISTINCT FROM 'past_due' OR u.past_due_since IS NULL THEN
    RETURN;
  END IF;
  IF now() < u.past_due_since + INTERVAL '7 days' THEN
    RETURN;
  END IF;

  PERFORM set_vessels_lapsed(p_owner_id);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- reconcile_vessel_overflow / apply_overflow_fallback / choose_active_vessels
--
-- DOWNGRADE_GRACE_DAYS = 14, mirrored from lib/tier-config.ts, per spec
-- §5's explicit number.
-- ────────────────────────────────────────────────────────────────────────────

-- Called whenever an account's tier/status might have just created
-- overflow (a downgrade, a fresh Basic resubscription, or lapsed
-- vessels being restored). Nothing locks here -- spec §5: "nothing
-- locks immediately." Starts a grace window if one isn't already
-- running; clears it if overflow no longer exists (e.g. they upgraded
-- back to Full, or decommissioned a vessel themselves before the window
-- closed). Admin accounts (is_admin_email(), same exemption as the
-- vessel-creation cap) never enter a grace window -- overflow logic is
-- another parallel path to the same cap this account is exempt from.
CREATE OR REPLACE FUNCTION reconcile_vessel_overflow(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier TEXT;
  owner_email TEXT;
  limit_for_tier INTEGER;
  active_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, email INTO owner_tier, owner_email FROM users WHERE id = p_owner_id;
  IF is_admin_email(owner_email) THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN;
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  SELECT count(*) INTO active_count
    FROM vessels
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active';

  IF active_count <= limit_for_tier THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN;
  END IF;

  UPDATE users
    SET downgrade_grace_until = now() + INTERVAL '14 days'
    WHERE id = p_owner_id AND downgrade_grace_until IS NULL;
END;
$$;

-- The lazy, per-owner fallback: once the grace window has actually
-- passed, lock every active vessel beyond the tier's limit, keeping the
-- N most recently touched (vessels.updated_at -- the only signal that
-- reflects real owner interaction across every vessel; see the build
-- plan for why this was chosen over the alternatives available today).
-- A no-op if the window hasn't closed, or the account no longer has
-- overflow (e.g. they freed a slot themselves in the meantime).
CREATE OR REPLACE FUNCTION apply_overflow_fallback(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier TEXT;
  owner_email TEXT;
  limit_for_tier INTEGER;
  grace_until TIMESTAMPTZ;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, downgrade_grace_until, email INTO owner_tier, grace_until, owner_email FROM users WHERE id = p_owner_id;

  IF is_admin_email(owner_email) THEN
    UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
    RETURN;
  END IF;

  IF grace_until IS NULL OR grace_until > now() THEN
    RETURN;
  END IF;

  limit_for_tier := vessel_limit_for_tier(owner_tier);

  WITH ranked AS (
    SELECT id, row_number() OVER (ORDER BY updated_at DESC) AS rn
    FROM vessels
    WHERE owner_id = p_owner_id AND qr_status = 'active' AND lifecycle_status = 'active'
  )
  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'locked', dormant_since = now()
    WHERE id IN (SELECT id FROM ranked WHERE rn > limit_for_tier);

  -- Spec §3 share revocation, same as set_vessels_lapsed above.
  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'locked'
      );

  UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
END;
$$;

-- The owner's explicit choice -- available any time there's overflow,
-- not just during the grace window (this is also the "actively swap
-- which vessels occupy their slots" reactivation path from spec §6).
-- Un-dormants exactly the chosen set (only ever from cause='locked' --
-- this never touches a lapsed or decommissioned vessel) and locks every
-- other currently-active vessel beyond it.
CREATE OR REPLACE FUNCTION choose_active_vessels(p_owner_id UUID, p_vessel_ids UUID[])
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  owner_tier TEXT;
  owner_email TEXT;
  limit_for_tier INTEGER;
  chosen_count INTEGER;
  valid_count INTEGER;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(p_owner_id::text));

  SELECT subscription_tier, email INTO owner_tier, owner_email FROM users WHERE id = p_owner_id;
  limit_for_tier := vessel_limit_for_tier(owner_tier);

  chosen_count := coalesce(array_length(p_vessel_ids, 1), 0);
  IF chosen_count > limit_for_tier AND NOT is_admin_email(owner_email) THEN
    RAISE EXCEPTION 'Chose % vessels, but the current plan allows %.', chosen_count, limit_for_tier;
  END IF;

  SELECT count(*) INTO valid_count
    FROM vessels
    WHERE id = ANY(p_vessel_ids) AND owner_id = p_owner_id AND qr_status = 'active';
  IF valid_count <> chosen_count THEN
    RAISE EXCEPTION 'One or more chosen vessels do not belong to this account.';
  END IF;

  UPDATE vessels
    SET lifecycle_status = 'active', dormant_cause = NULL, dormant_since = NULL
    WHERE id = ANY(p_vessel_ids) AND owner_id = p_owner_id;

  UPDATE vessels
    SET lifecycle_status = 'dormant', dormant_cause = 'locked', dormant_since = now()
    WHERE owner_id = p_owner_id
      AND qr_status = 'active'
      AND lifecycle_status = 'active'
      AND NOT (id = ANY(p_vessel_ids));

  -- Spec §3 share revocation, same as set_vessels_lapsed /
  -- apply_overflow_fallback above -- an explicit swap that newly locks a
  -- vessel revokes its shares exactly the same as the automatic fallback
  -- would have.
  UPDATE vessel_shares
    SET revoked_at = now()
    WHERE revoked_at IS NULL
      AND vessel_id IN (
        SELECT id FROM vessels
        WHERE owner_id = p_owner_id AND lifecycle_status = 'dormant' AND dormant_cause = 'locked'
      );

  UPDATE users SET downgrade_grace_until = NULL WHERE id = p_owner_id;
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- reconcile_owner_dormancy -- both lazy checks for one owner, in one call.
-- The single thing the dashboard and public-page loads call.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reconcile_owner_dormancy(p_owner_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM apply_past_due_dormancy_if_expired(p_owner_id);
  PERFORM apply_overflow_fallback(p_owner_id);
END;
$$;

-- ────────────────────────────────────────────────────────────────────────────
-- reconcile_all_dormancy -- the admin-load-wide version.
--
-- Without a scheduled job, an owner who lapses and never logs back in
-- (and whose vessel is never scanned) would otherwise sit at
-- lifecycle_status='active' indefinitely -- correct from their own
-- session's point of view (nothing ever loads to trigger the per-owner
-- check), but wrong for anything reading vessel/account state in bulk.
-- Called at the top of /admin so its counts self-heal on every load
-- instead of drifting between visits. Iterates only accounts that could
-- plausibly need it (past_due or an expired grace window), not the
-- whole table.
-- ────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION reconcile_all_dormancy()
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT id FROM users WHERE subscription_status = 'past_due' LOOP
    PERFORM apply_past_due_dormancy_if_expired(r.id);
  END LOOP;

  FOR r IN SELECT id FROM users WHERE downgrade_grace_until IS NOT NULL AND downgrade_grace_until < now() LOOP
    PERFORM apply_overflow_fallback(r.id);
  END LOOP;
END;
$$;
