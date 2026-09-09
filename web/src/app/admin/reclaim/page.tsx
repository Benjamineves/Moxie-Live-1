import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { ReclaimForm } from "./ReclaimForm";

/**
 * Reclaim a badge from a checkout that was never completed (20260927).
 *
 * On its own page, and deliberately not on the stickers queue or the
 * batch contact sheet. Both of those are places you move quickly through
 * many rows, which is precisely where a control that deletes a vessel
 * should not live. Here there is one vessel at a time, reached by typing
 * its ID.
 */
export default async function ReclaimPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const service = createSupabaseServiceClient();
  if (!service) redirect("/dashboard");

  const { data: logRows } = await service
    .from("badge_reclaim_log")
    .select("mxe_id, vessel_name, owner_email, reason, reclaimed_by, reclaimed_at")
    .order("reclaimed_at", { ascending: false })
    .limit(25);

  const log = (logRows ?? []) as {
    mxe_id: string;
    vessel_name: string | null;
    owner_email: string | null;
    reason: string;
    reclaimed_by: string;
    reclaimed_at: string;
  }[];

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-3xl">
        <AdminNav current="/admin/reclaim" />

        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Admin
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Reclaim a badge
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            A badge is claimed the moment a vessel is created, which happens before payment. When a
            checkout is abandoned that badge is stuck on a vessel that will never exist. This deletes
            the vessel and puts its badge back on the shelf.
          </p>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            <strong>Only for a vessel that was never active and whose badge never went out.</strong>{" "}
            Anything that has been paid for, shipped, shared, transferred or decommissioned keeps its
            MXE ID forever — that ID may be on a hull.
          </p>
        </header>

        <ReclaimForm />

        <section className="mt-10">
          <p className="mb-3 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Reclaim log
          </p>
          {log.length === 0 ? (
            <p className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
              Nothing has been reclaimed yet.
            </p>
          ) : (
            <div className="overflow-hidden rounded-xl border border-[var(--divider)] bg-[var(--white)]">
              {log.map((row, i) => (
                <div
                  key={`${row.mxe_id}-${row.reclaimed_at}`}
                  className={`p-4 ${i > 0 ? "border-t border-[var(--divider)]" : ""}`}
                >
                  <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                    {row.mxe_id} · {row.vessel_name ?? "(unnamed)"}
                  </p>
                  <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
                    {row.reason}
                  </p>
                  <p className="mt-0.5 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                    {row.owner_email ?? "no owner email"} · by {row.reclaimed_by} ·{" "}
                    {new Date(row.reclaimed_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
