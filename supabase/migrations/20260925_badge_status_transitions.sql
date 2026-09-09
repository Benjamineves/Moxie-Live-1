-- Stage 6: badge status advancement (spec §5.0.3, §5.0.4).
--
-- Two batch-level transitions and one per-identity one, all in the
-- database rather than in the admin action that calls them.
--
-- WHY THESE ARE FUNCTIONS AND NOT UPDATE STATEMENTS IN THE APP
--
-- §5.0.3's gate — "zero rows in the batch may have artwork_path IS NULL"
-- — is what makes an identity with no artwork structurally impossible to
-- ship rather than merely discouraged. A gate enforced in a server
-- action is a gate that a second caller, a future refactor, or a hand-run
-- UPDATE walks straight through. Enforced here, the only way past it is
-- to render the artwork.
--
-- The admin UI still shows the precondition and greys the button. That
-- is a courtesy so the operator knows why they cannot proceed; it is not
-- the control.

-- ---------------------------------------------------------------------
-- Column semantics, pinned down before anything writes them.
--
-- shipped_at is the one that reads wrong at a glance. It records the
-- badge leaving the PRINTER for our shelf (printed -> in_stock), not the
-- badge leaving us for a customer — there is no per-identity customer
-- despatch event in this table, and §2.5 keeps it that way. Naming it in
-- the schema rather than in a commit message so the next person to read
-- "shipped" does not assume fulfilment.
-- ---------------------------------------------------------------------
COMMENT ON COLUMN public.badge_identities.printed_at IS
  'Set batch-wide on minted -> printed: sheets received from the printer and inspected (spec 5.0.4).';

COMMENT ON COLUMN public.badge_identities.shipped_at IS
  'Set batch-wide on printed -> in_stock: shipped BY THE PRINTER and now cut, finished and on our shelf. NOT despatch to a customer — this table has no such event (spec 2.5, 5.0.4).';

-- ---------------------------------------------------------------------
-- advance_badge_batch_status
--
-- Returns the number of identities advanced. Raises rather than
-- returning a status code: every failure here is an operator error or a
-- real precondition violation, and both should abort the transaction
-- loudly rather than be a number someone forgets to check.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.advance_badge_batch_status(
  p_batch_id  UUID,
  p_to_status TEXT
) RETURNS INTEGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from_status TEXT;
  v_total       INTEGER;
  v_wrong_state INTEGER;
  v_missing_art INTEGER;
  v_advanced    INTEGER;
BEGIN
  -- Only the two manual transitions in §5.0.4 are batch-level. 'assigned'
  -- is the system's to write at signup (§3.1) and 'void' is per identity
  -- (§5.0.4), so neither is reachable through this function at all.
  v_from_status := CASE p_to_status
    WHEN 'printed'  THEN 'minted'
    WHEN 'in_stock' THEN 'printed'
    ELSE NULL
  END;

  IF v_from_status IS NULL THEN
    RAISE EXCEPTION
      'advance_badge_batch_status: % is not a batch-level transition (expected printed or in_stock)',
      p_to_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Serialises concurrent advances of the same batch. Two admins double
  -- clicking would otherwise both read 'minted', both pass the gate, and
  -- both run the UPDATE; the second would advance zero rows, which is
  -- harmless, but the lock makes the outcome deterministic rather than
  -- accidentally harmless.
  PERFORM 1 FROM badge_print_batches WHERE id = p_batch_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'advance_badge_batch_status: batch % does not exist', p_batch_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- Voided identities are excluded from every count below. A damaged
  -- badge is deliberately dead (§5.0.4) and must not hold the other
  -- ninety-nine on the bench — nor is it required to have artwork, since
  -- a batch abandoned mid-render is voided exactly as it stands.
  SELECT
    count(*),
    count(*) FILTER (WHERE status <> v_from_status),
    count(*) FILTER (WHERE artwork_path IS NULL)
  INTO v_total, v_wrong_state, v_missing_art
  FROM badge_identities
  WHERE print_batch_id = p_batch_id
    AND status <> 'void';

  IF v_total = 0 THEN
    RAISE EXCEPTION
      'advance_badge_batch_status: batch % has no live identities to advance', p_batch_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_wrong_state > 0 THEN
    RAISE EXCEPTION
      'advance_badge_batch_status: % of % identities are not in status % — batch is not ready to become %',
      v_wrong_state, v_total, v_from_status, p_to_status
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- §5.0.3's gate. Checked for BOTH transitions, not just minted ->
  -- printed: the spec places it on the first gate because that is where
  -- an unrendered batch would escape, but re-checking on the second
  -- costs one count and closes the door on artwork that disappears after
  -- printing. There is no transition into stock that does not pass here.
  IF v_missing_art > 0 THEN
    RAISE EXCEPTION
      'advance_badge_batch_status: % of % identities have no artwork — render them before advancing to %',
      v_missing_art, v_total, p_to_status
      USING ERRCODE = 'check_violation';
  END IF;

  UPDATE badge_identities
     SET status     = p_to_status,
         printed_at = CASE WHEN p_to_status = 'printed'  THEN COALESCE(printed_at, now()) ELSE printed_at END,
         shipped_at = CASE WHEN p_to_status = 'in_stock' THEN COALESCE(shipped_at, now()) ELSE shipped_at END
   WHERE print_batch_id = p_batch_id
     AND status = v_from_status;

  GET DIAGNOSTICS v_advanced = ROW_COUNT;

  -- The batch's own record of the physical moment. COALESCE so a batch
  -- advanced, voided back, and advanced again keeps the first date the
  -- sheets actually arrived.
  IF p_to_status = 'printed' THEN
    UPDATE badge_print_batches
       SET received_at = COALESCE(received_at, now())
     WHERE id = p_batch_id;
  END IF;

  RETURN v_advanced;
END;
$$;

-- ---------------------------------------------------------------------
-- void_badge_identity
--
-- Per identity, with a reason, because damage is per object (§5.0.4).
--
-- ASSIGNED IDENTITIES CANNOT BE VOIDED HERE, and this is a deliberate
-- narrowing of §5.0.4's "any -> void". An assigned identity's badge is on
-- a customer's hull and its token is live: voiding it would make
-- /s/<token> answer "no longer valid" for a boat that is registered and
-- paid up, with no way to reach the owner and no way to un-print the
-- badge. Nothing legitimate needs it — a damaged customer badge is a
-- reprint from stored artwork (§5.1), and decommission and transfer both
-- leave badge_identities untouched by design (§2.5).
--
-- Blocking is the recoverable choice: if a real need appears, the rule
-- is one migration away. The reverse mistake is not recoverable.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_badge_identity(
  p_identity_id UUID,
  p_reason      TEXT
) RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_status TEXT;
BEGIN
  IF p_reason IS NULL OR btrim(p_reason) = '' THEN
    RAISE EXCEPTION 'void_badge_identity: a reason is required'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  SELECT status INTO v_status
  FROM badge_identities
  WHERE id = p_identity_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'void_badge_identity: identity % does not exist', p_identity_id
      USING ERRCODE = 'no_data_found';
  END IF;

  IF v_status = 'void' THEN
    RAISE EXCEPTION 'void_badge_identity: identity % is already void', p_identity_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF v_status = 'assigned' THEN
    RAISE EXCEPTION
      'void_badge_identity: identity % is assigned to a vessel; voiding it would kill a live badge on a customer hull. Reprint from stored artwork instead (spec 5.1).',
      p_identity_id
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  UPDATE badge_identities
     SET status      = 'void',
         voided_at   = now(),
         void_reason = btrim(p_reason)
   WHERE id = p_identity_id;
END;
$$;

-- ---------------------------------------------------------------------
-- Execute grants.
--
-- Same lockdown as 20260923: CREATE FUNCTION grants EXECUTE to PUBLIC by
-- default and PostgREST publishes anything executable as an RPC. Both of
-- these mutate inventory, so both are service_role only, reached through
-- an admin action that does its own ADMIN_EMAILS check.
-- ---------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.advance_badge_batch_status(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.advance_badge_batch_status(UUID, TEXT)
  TO service_role;

REVOKE EXECUTE ON FUNCTION public.void_badge_identity(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.void_badge_identity(UUID, TEXT)
  TO service_role;
