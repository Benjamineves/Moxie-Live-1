import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { DECOMMISSION_REASON_LABELS, type DecommissionReason } from "@/lib/vessel-decommission";
import { RequestActionButtons } from "./RequestActionButtons";
import { ReactivateButton } from "./ReactivateButton";

type RequestRow = {
  id: string;
  mxe_id: string;
  reason: string;
  notes: string | null;
  status: string;
  decline_reason: string | null;
  created_at: string;
};

type DecommissionedVessel = {
  id: string;
  mxe_id: string;
  vessel_name: string;
  decommissioned_at: string | null;
  decommission_reason: string | null;
};

function reasonLabel(reason: string): string {
  return DECOMMISSION_REASON_LABELS[reason as DecommissionReason] ?? reason;
}

type Props = {
  searchParams: Promise<{ resolved?: string }>;
};

/**
 * Admin-visible queue for owner-submitted decommission requests, plus a
 * second section listing currently-decommissioned vessels with a
 * Reactivate action. Approve/decline mirror the correction-requests
 * page's layout; decommission needs both (correction requests don't have
 * a decline path), and needs reactivation, which correction requests
 * have no equivalent of at all.
 */
export default async function VesselDecommissionRequestsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const showingResolved = sp.resolved === "1";

  const { data: rows, error } = await service
    .from("vessel_decommission_requests")
    .select("id, mxe_id, reason, notes, status, decline_reason, created_at")
    .in("status", showingResolved ? ["approved", "declined"] : ["pending"])
    .order("created_at", { ascending: showingResolved ? false : true });

  const requests = (rows ?? []) as RequestRow[];

  const { data: decommissionedRows } = await service
    .from("vessels")
    .select("id, mxe_id, vessel_name, decommissioned_at, decommission_reason")
    .eq("lifecycle_status", "decommissioned")
    .order("decommissioned_at", { ascending: false });
  const decommissionedVessels = (decommissionedRows ?? []) as DecommissionedVessel[];

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/vessel-decommission-requests" />
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Admin
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              Vessel decommission requests
            </h1>
            <p className="mt-2 max-w-2xl font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Owner requests to archive a vessel — a status change, never a deletion. Approving revokes every active
              share link for that vessel and stops it counting against the owner&apos;s 5-vessel cap; the record,
              documents, and history all stay intact.
            </p>
          </div>
          <Link
            href={
              showingResolved
                ? "/admin/vessel-decommission-requests"
                : "/admin/vessel-decommission-requests?resolved=1"
            }
            className="font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
          >
            {showingResolved ? "Show pending" : "Show resolved"}
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t load requests: {error.message}
            </p>
          </div>
        ) : requests.length === 0 ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              {showingResolved ? "No resolved requests." : "No pending requests."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {requests.map((r) => (
              <div key={r.id} className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                      {r.mxe_id} · {reasonLabel(r.reason)}
                    </p>
                    {r.notes ? (
                      <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                        &ldquo;{r.notes}&rdquo;
                      </p>
                    ) : null}
                    {showingResolved ? (
                      <p className="mt-1 font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                        {r.status}
                        {r.decline_reason ? ` — "${r.decline_reason}"` : ""}
                      </p>
                    ) : null}
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                      Submitted {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  {!showingResolved ? (
                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <RequestActionButtons requestId={r.id} mxeId={r.mxe_id} reasonLabel={reasonLabel(r.reason)} />
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        )}

        <section className="mt-10">
          <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Currently decommissioned
          </p>
          {decommissionedVessels.length === 0 ? (
            <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                No decommissioned vessels.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {decommissionedVessels.map((v) => (
                <div
                  key={v.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm"
                >
                  <div>
                    <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                      {v.mxe_id} · {v.vessel_name}
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                      {v.decommission_reason ? reasonLabel(v.decommission_reason) : "—"}
                      {v.decommissioned_at ? ` · ${new Date(v.decommissioned_at).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <ReactivateButton vesselId={v.id} mxeId={v.mxe_id} />
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
