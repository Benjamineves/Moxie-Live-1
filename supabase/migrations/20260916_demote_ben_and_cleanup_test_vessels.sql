-- Cleanup step for the second-admin-identity rollout
-- (20260915_second_admin_identity.sql). Run this ONLY after Ben has
-- confirmed admin@moxieyachting.com reaches the admin routes correctly
-- (sticker fulfillment queue, correction-request workflow, ownership-
-- transfer actions) — this demotes the old admin identity and removes
-- its test data, so don't run it while admin@moxieyachting.com is still
-- unconfirmed.
--
-- DESTRUCTIVE: the second half of this file permanently deletes 4
-- vessels and everything referencing them. Prepared, not run — per
-- standing project instruction, Ben runs this himself in the Supabase
-- SQL Editor.
--
-- Two independent things:
--   1. Demote ben@moxieyachting.com's public.users.role from 'admin'
--      back to 'owner'. Matched by email, same as every other identity
--      lookup this app already does for this account (its users.id
--      doesn't match its real Supabase Auth id — see
--      lib/admin-verify.ts's requireAdmin() comment, "build spec
--      §9-C-13" — so an id-based UPDATE would silently match nothing).
--   2. Hard-delete its 4 test vessels: "bob," "Bingo," "Maui," "Racer x"
--      (MXE-01014, MXE-01013, MXE-01008, MXE-01007). These are the same
--      4 vessels affected by the owner_id mismatch above — all seeded
--      test data, confirmed via read-only query to have no real
--      customer overlap. Deleted in the same dependency order
--      delete_unactivated_vessel() uses
--      (20260909_delete_unactivated_vessel.sql), plus
--      owner_notifications, which didn't exist yet when that function
--      was written (added in 20260913_dormant_identity.sql) and isn't
--      covered by it.
--
-- Both the mxe_id list AND owner_id are checked together as a safety
-- cross-check, so this can't silently touch a differently-owned vessel
-- even if an mxe_id were ever reused.

UPDATE users
  SET role = 'owner'
  WHERE email = 'ben@moxieyachting.com';

DO $$
DECLARE
  target_ids UUID[];
BEGIN
  SELECT array_agg(id) INTO target_ids
    FROM vessels
    WHERE mxe_id IN ('MXE-01007', 'MXE-01008', 'MXE-01013', 'MXE-01014')
      AND owner_id = '00000000-0000-0000-0000-000000000001';

  IF target_ids IS NULL OR array_length(target_ids, 1) IS NULL THEN
    RAISE NOTICE 'No matching test vessels found (already deleted, or owner_id no longer matches) — nothing to delete.';
    RETURN;
  END IF;

  DELETE FROM vessel_shares WHERE vessel_id = ANY (target_ids);
  DELETE FROM vessel_decommission_requests WHERE vessel_id = ANY (target_ids);
  DELETE FROM vessel_identity_correction_requests WHERE vessel_id = ANY (target_ids);
  DELETE FROM vessel_identity_audit_log WHERE vessel_id = ANY (target_ids);
  DELETE FROM ownership_transfers WHERE vessel_id = ANY (target_ids);
  DELETE FROM vessel_documents WHERE vessel_id = ANY (target_ids);
  DELETE FROM qr_tokens WHERE vessel_id = ANY (target_ids);
  DELETE FROM vessel_payments WHERE vessel_id = ANY (target_ids);
  DELETE FROM ownership_history WHERE vessel_id = ANY (target_ids);
  DELETE FROM owner_notifications WHERE vessel_id = ANY (target_ids);
  DELETE FROM vessels WHERE id = ANY (target_ids);

  RAISE NOTICE 'Deleted % test vessel(s): %', array_length(target_ids, 1), target_ids;
END $$;
