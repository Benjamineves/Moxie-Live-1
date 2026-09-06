import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { DECOMMISSION_REASON_LABELS, type DecommissionReason } from "@/lib/vessel-decommission";
import { RequestActionButtons } from "./RequestActionButtons";
import { ReactivateButton } from "./ReactivateButton";
import { ActiveSharesIndicator } from "./ActiveSharesIndicator";

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

  /*
   * Active Trusted Contact shares per vessel, for pending
   * "sold outside Moxie" requests only.
   *
   * Context, not a gate — nothing below blocks or even warns on this.
   * A vessel being handed to a buyer while broad share links are still
   * live is the pattern worth a glance before approving, because
   * approval revokes those links and whoever was using them simply
   * stops being able to load the profile. Seeing the count first lets
   * an admin decide whether that's worth a message.
   *
   * Pending only, deliberately. On an approved request the count would
   * always read zero — approval revokes every share as part of the same
   * transaction — so showing it there would describe the approval, not
   * the vessel at the time it was requested, which is the opposite of
   * useful.
   */
  const saleReasonMxeIds = showingResolved
    ? []
    : [...new Set(requests.filter((r) => r.reason === "sold_outside_moxie").map((r) => r.mxe_id))];

  const activeShareCounts = new Map<string, number>();
  if (saleReasonMxeIds.length > 0) {
    const { data: vesselRows } = await service
      .from("vessels")
      .select("id, mxe_id")
      .in("mxe_id", saleReasonMxeIds);
    const vessels = (vesselRows ?? []) as { id: string; mxe_id: string }[];

    if (vessels.length > 0) {
      // Same "active" rule the owner's own shares page applies — not
      // revoked, and either no expiry or an expiry still in the future —
      // expressed as query filters so the two can't quietly diverge.
      const { data: shareRows } = await service
        .from("vessel_shares")
        .select("vessel_id")
        .in("vessel_id", vessels.map((v) => v.id))
        .is("revoked_at", null)
        .or(`expires_at.is.null,expires_at.gt.${new Date().toISOString()}`);
      const shares = (shareRows ?? []) as { vessel_id: string }[];

      const byVesselId = new Map(vessels.map((v) => [v.id, v.mxe_id]));
      for (const mxeId of saleReasonMxeIds) activeShareCounts.set(mxeId, 0);
      for (const share of shares) {
        const mxeId = byVesselId.get(share.vessel_id);
        if (mxeId) activeShareCounts.set(mxeId, (activeShareCounts.get(mxeId) ?? 0) + 1);
      }
    }
  }

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
              share link for that vessel and stops it counting against the owner&apos;s plan vessel cap; the record,
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
                    {activeShareCounts.has(r.mxe_id) ? (
                      <ActiveSharesIndicator count={activeShareCounts.get(r.mxe_id) ?? 0} />
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
