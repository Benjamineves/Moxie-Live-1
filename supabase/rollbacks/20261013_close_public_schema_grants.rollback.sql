-- ROLLBACK for migrations/20261013_close_public_schema_grants.sql.
--
-- Restores the grants, default privileges and three policies EXACTLY as the
-- security snapshot showed them live on 2026-09-25 05:06 UTC. That state gives
-- the public key TRUNCATE on 17 tables and opens every new object by default —
-- run only to undo a breakage. It does NOT re-grant SELECT on vessels
-- (20261010) or anything on the 8 tables that were already closed.
--
-- Not a migration: kept outside supabase/migrations/ so no tooling runs it.

BEGIN;

GRANT ALL ON TABLE
  public.account_payments, public.badge_identities, public.badge_print_batches,
  public.badge_reclaim_log, public.marinas, public.owner_notifications,
  public.ownership_history, public.ownership_transfers, public.qr_tokens,
  public.users, public.vessel_decommission_requests, public.vessel_documents,
  public.vessel_identity_audit_log, public.vessel_identity_correction_requests,
  public.vessel_payments, public.vessel_shares, public.waitlist
TO anon, authenticated;

GRANT INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.vessels TO anon, authenticated;

GRANT USAGE, SELECT, UPDATE ON SEQUENCE public.mxe_id_seq TO anon, authenticated;

GRANT EXECUTE ON FUNCTION public.update_updated_at() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_vessel_identity_changes() TO anon, authenticated;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

CREATE POLICY "Owners read own ownership history" ON public.ownership_history
  FOR SELECT USING (vessel_id IN (SELECT vessels.id FROM vessels WHERE vessels.owner_id = auth.uid()));
CREATE POLICY "Owners read own vessel documents" ON public.vessel_documents
  FOR SELECT USING (vessel_id IN (SELECT vessels.id FROM vessels WHERE vessels.owner_id = auth.uid()));
CREATE POLICY "Owners read own vessel payments" ON public.vessel_payments
  FOR SELECT USING (vessel_id IN (SELECT vessels.id FROM vessels WHERE vessels.owner_id = auth.uid()));

COMMIT;

NOTIFY pgrst, 'reload schema';
