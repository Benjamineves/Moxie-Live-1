import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";

type LogRow = {
  id: string;
  mxe_id: string;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
  changed_by: string | null;
};

/**
 * Read-only view onto vessel_identity_audit_log (see migration
 * 20260830_vessel_identity_lock_and_audit.sql) — a fraud-deterrent trail
 * for the locked, identity-defining vessel fields (HIN, make, model,
 * year, length, draft, engine, USCG doc #, official #, vessel type).
 * Those fields have no self-serve edit path at all; every row here comes
 * from a direct-DB support fix, logged by a trigger regardless of how the
 * edit happened. Same admin gate as the sticker queue — see
 * lib/admin-verify.ts.
 */
export default async function VesselIdentityLogPage() {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const { data: rows, error } = await service
    .from("vessel_identity_audit_log")
    .select("id, mxe_id, field_name, old_value, new_value, changed_at, changed_by")
    .order("changed_at", { ascending: false })
    .limit(200);

  const logRows = (rows ?? []) as LogRow[];

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/vessel-identity-log" />
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Admin
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Vessel identity change log
          </h1>
          <p className="mt-2 max-w-2xl font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Every change to a locked, identity-defining field (HIN, make, model, year, length, draft, engine,
            USCG doc #, official #, vessel type). These have no in-app edit path — every row here came from a
            direct database fix. &ldquo;Changed by&rdquo; is best-effort, not guaranteed: it&apos;s only populated
            when the operator set <code className="rounded bg-[var(--cream2)] px-1 text-xs">app.changed_by</code>{" "}
            before running the update.
          </p>
        </header>

        {error ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t load the log: {error.message}
            </p>
          </div>
        ) : logRows.length === 0 ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              No identity-field changes recorded yet.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[var(--divider)] bg-[var(--white)] shadow-sm">
            <table className="w-full min-w-[720px] text-left font-[family-name:var(--font-dm)] text-sm">
              <thead>
                <tr className="border-b border-[var(--divider)] text-xs uppercase tracking-[0.1em] text-[var(--text3)]">
                  <th className="px-4 py-3">When</th>
                  <th className="px-4 py-3">Vessel</th>
                  <th className="px-4 py-3">Field</th>
                  <th className="px-4 py-3">Old value</th>
                  <th className="px-4 py-3">New value</th>
                  <th className="px-4 py-3">Changed by</th>
                </tr>
              </thead>
              <tbody>
                {logRows.map((row) => (
                  <tr key={row.id} className="border-b border-[var(--divider)] last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-[var(--text2)]">
                      {new Date(row.changed_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 font-medium text-[var(--navy)]">{row.mxe_id}</td>
                    <td className="px-4 py-3 text-[var(--text2)]">{row.field_name}</td>
                    <td className="px-4 py-3 text-[var(--text3)] line-through">{row.old_value || "—"}</td>
                    <td className="px-4 py-3 font-medium text-[var(--navy)]">{row.new_value || "—"}</td>
                    <td className="px-4 py-3 text-[var(--text2)]">{row.changed_by || "unknown"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </main>
    </div>
  );
}
