-- Stage 7a: assignment (spec §3.1, §3.2).
--
-- Claims a badge identity from stock and inserts the vessel in ONE
-- transaction. §3.1 requires exactly that: if the vessel insert fails,
-- the badge must go back to the shelf rather than being stranded as
-- 'assigned' with a null vessel_id. Two round-trips from the app cannot
-- give that, which is why the insert moves in here.
--
-- WHY THE COLUMN LIST IS NOT WRITTEN OUT
--
-- vessels has ~40 columns and createVessel already builds the exact
-- object it wants to write. Restating that list in SQL would create a
-- second place to update every time a column is added — the precise
-- drift this codebase has been bitten by repeatedly. Instead the payload
-- arrives as JSONB, its keys are validated against the real table, and
-- the INSERT names only the keys actually supplied so every unspecified
-- column keeps its database DEFAULT.
--
-- That last part is load-bearing. `INSERT INTO vessels SELECT * FROM
-- jsonb_populate_record(NULL::vessels, payload)` would look equivalent
-- and be badly wrong: unspecified fields come back NULL and are then
-- written as NULL, overriding DEFAULTs — including
-- qr_status DEFAULT 'pending_payment'. A vessel inserted with a NULL
-- qr_status would never be activated by the Stripe webhook, which
-- updates WHERE qr_status = 'pending_payment'. Paid, and permanently
-- stuck.

CREATE OR REPLACE FUNCTION public.create_vessel_with_badge(p_vessel JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_identity_id UUID;
  v_mxe_id      TEXT;
  v_from_pool   BOOLEAN := false;
  v_vessel_id   UUID;
  v_bad_key     TEXT;
  v_cols        TEXT;
BEGIN
  IF p_vessel IS NULL OR jsonb_typeof(p_vessel) <> 'object' THEN
    RAISE EXCEPTION 'create_vessel_with_badge: payload must be a JSON object'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- These three are decided here, not by the caller. Accepting an mxe_id
  -- from the app is what the old proposedMxeId path did, and it is the
  -- thing that let a customer be shown one ID and given another.
  IF p_vessel ?| ARRAY['id', 'mxe_id', 'badge_identity_id'] THEN
    RAISE EXCEPTION
      'create_vessel_with_badge: id, mxe_id and badge_identity_id are assigned by this function, not passed in'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Reject unknown keys rather than silently dropping them. A typo in a
  -- column name would otherwise write a vessel missing a field nobody
  -- notices until an owner opens their profile.
  SELECT k INTO v_bad_key
  FROM jsonb_object_keys(p_vessel) AS k
  WHERE k NOT IN (
    SELECT attname FROM pg_attribute
    WHERE attrelid = 'public.vessels'::regclass AND attnum > 0 AND NOT attisdropped
  )
  LIMIT 1;

  IF v_bad_key IS NOT NULL THEN
    RAISE EXCEPTION 'create_vessel_with_badge: % is not a column of vessels', v_bad_key
      USING ERRCODE = 'undefined_column';
  END IF;

  -- §3.1's claim. FOR UPDATE SKIP LOCKED is the mechanism: two
  -- simultaneous signups take different rows rather than one blocking or
  -- both taking the same one. ORDER BY mxe_id drains stock oldest-first
  -- so the physical shelf is worked front-to-back.
  --
  -- Status is NOT set here. badge_identities_assigned_has_vessel requires
  -- a vessel_id whenever status = 'assigned', and the vessel does not
  -- exist yet — so the row is locked now and marked after the insert,
  -- inside this same transaction. The lock is what makes that safe.
  SELECT id, mxe_id
    INTO v_identity_id, v_mxe_id
    FROM badge_identities
   WHERE status = 'in_stock'
     AND distribution_channel = 'direct'
   ORDER BY mxe_id
   LIMIT 1
   FOR UPDATE SKIP LOCKED;

  IF v_identity_id IS NULL THEN
    -- §3.2: the pool is empty. Degrade explicitly to mint-on-demand
    -- rather than blocking signup — a stopped signup is a lost customer,
    -- one hand-printed badge is an afternoon's annoyance. The vessel is
    -- created with badge_identity_id NULL, and from_pool = false is what
    -- the fulfilment queue keys its "print individually" flag off.
    v_mxe_id := next_mxe_id();
  ELSE
    v_from_pool := true;
  END IF;

  SELECT string_agg(quote_ident(k), ', ' ORDER BY k)
    INTO v_cols
    FROM jsonb_object_keys(p_vessel) AS k;

  IF v_cols IS NULL THEN
    RAISE EXCEPTION 'create_vessel_with_badge: payload is empty'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Only the supplied columns are named, so every other column keeps its
  -- DEFAULT. jsonb_populate_record does the type coercion, so the app
  -- keeps sending plain JSON and Postgres decides what a date or a
  -- numeric means.
  EXECUTE format(
    'INSERT INTO vessels (mxe_id, badge_identity_id, %1$s)
     SELECT $1, $2, %1$s FROM jsonb_populate_record(NULL::vessels, $3)
     RETURNING id',
    v_cols
  )
  USING v_mxe_id, v_identity_id, p_vessel
  INTO v_vessel_id;

  -- Now the vessel exists, so the constraint can be satisfied. If the
  -- insert above raised, this never runs and the whole transaction rolls
  -- back — the identity is untouched and stays in_stock, which is
  -- precisely the property §3.1 asks for.
  IF v_identity_id IS NOT NULL THEN
    UPDATE badge_identities
       SET status      = 'assigned',
           assigned_at = now(),
           vessel_id   = v_vessel_id
     WHERE id = v_identity_id;
  END IF;

  RETURN jsonb_build_object(
    'mxe_id',            v_mxe_id,
    'badge_identity_id', v_identity_id,
    'from_pool',         v_from_pool
  );
END;
$$;

-- Same lockdown as 20260923 and 20260925: CREATE FUNCTION grants EXECUTE
-- to PUBLIC by default and PostgREST publishes anything executable as an
-- RPC. This one creates vessels and consumes inventory, so it is
-- service_role only, reached through a server action that has already
-- authenticated the owner.
REVOKE EXECUTE ON FUNCTION public.create_vessel_with_badge(JSONB)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_vessel_with_badge(JSONB)
  TO service_role;
