-- Trusted Contact Sharing (docs/moxie_digital_technical_spec_share_profile.md §2).

CREATE TABLE IF NOT EXISTS vessel_shares (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vessel_id       UUID REFERENCES vessels(id) NOT NULL,
  created_by      UUID REFERENCES users(id) NOT NULL,     -- must be current vessel owner at creation time
  label           TEXT,                                    -- "Diver — Juan", "Escrow — Triton Marine Title"
  preset          TEXT,                                     -- 'escrow' | 'marina' | 'vendor' | 'custom' | NULL
  token_hash      TEXT NOT NULL UNIQUE,                     -- sha256(token) — raw token is NEVER persisted
  field_flags     JSONB NOT NULL DEFAULT '{}'::jsonb,       -- see §3
  access_note     TEXT,                                     -- owner-authored, this-share-only (lockbox codes etc.)
  expires_at      TIMESTAMPTZ,                              -- NULL = no expiry
  one_time        BOOLEAN NOT NULL DEFAULT false,
  view_count      INTEGER NOT NULL DEFAULT 0,
  last_viewed_at  TIMESTAMPTZ,
  revoked_at      TIMESTAMPTZ,                              -- NULL = active
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_vessel_shares_vessel ON vessel_shares(vessel_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_vessel_shares_token ON vessel_shares(token_hash);

-- Locked down entirely, same pattern as every other owner-data table in
-- this app (vessel_documents, vessel_identity_audit_log,
-- vessel_identity_correction_requests): no anon/authenticated policy is
-- added. The spec (§2) describes an owner-scoped RLS policy assuming
-- direct authenticated-client access, but nothing in this codebase's
-- owner-mutation surface actually works that way — every owner write
-- goes through a server action or route handler using the service-role
-- client with an app-level ownership check (resolveOwnerIds/
-- loadOwnedVessel, see lib/vessel-ownership.ts), not RLS. Matching that
-- convention here: the three owner-facing endpoints (POST/GET create+
-- list, DELETE revoke) enforce created_by/ownership in application code;
-- the public resolve endpoint (GET /api/share/:token) also runs as
-- service-role and does its own token/expiry/revocation check. RLS is
-- still enabled so the anon key can never reach this table directly even
-- if a future code path forgets to route through the service role.
ALTER TABLE vessel_shares ENABLE ROW LEVEL SECURITY;

-- Atomic check-and-consume for the public resolve endpoint (spec §5,
-- GET /api/share/:token). Supabase-js's plain .update() can't express
-- "increment view_count and conditionally revoke, but only if the row
-- still passes all validity checks" as one atomic statement (no
-- column = column + 1 support in the query builder) — a two-step
-- read-then-write from the route handler would reopen exactly the race
-- the spec's acceptance tests call out ("a second visit before the
-- first-view response has been re-fetched"). Folding the whole
-- check+increment+one-time-revoke into one UPDATE...RETURNING, run as
-- a single statement inside this function, makes the race structurally
-- impossible rather than merely unlikely: a concurrent second call's
-- WHERE clause (view_count < 1) is re-evaluated against whatever the
-- first call already committed, so at most one call's UPDATE can ever
-- match a given one-time share's row.
--
-- Returns zero rows for every failure case alike (not found, revoked,
-- expired, already-used one-time link) — the route handler renders the
-- same generic "not active" response regardless of which, matching the
-- spec's explicit "don't distinguish why" requirement structurally, not
-- just as an API-layer convention.
CREATE OR REPLACE FUNCTION resolve_vessel_share(p_token_hash TEXT)
RETURNS SETOF vessel_shares
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE vessel_shares
  SET
    view_count = view_count + 1,
    last_viewed_at = now(),
    revoked_at = CASE WHEN one_time THEN now() ELSE revoked_at END
  WHERE token_hash = p_token_hash
    AND revoked_at IS NULL
    AND (expires_at IS NULL OR expires_at > now())
    AND (one_time = false OR view_count < 1)
  RETURNING *;
END;
$$;
