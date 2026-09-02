import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { TRANSFER_STATUS_LABELS, type TransferStatus } from "@/lib/vessel-transfer";
import { ReverseTransferButton } from "./ReverseTransferButton";

type TransferRow = {
  id: string;
  mxe_id: string;
  buyer_email: string;
  status: TransferStatus;
  created_at: string;
  completed_at: string | null;
};

type Props = {
  searchParams: Promise<{ history?: string }>;
};

/**
 * Oversight, not a decision queue — unlike the sticker/correction/
 * decommission admin pages, nothing here needs routine admin action.
 * Transfers move themselves from seller-initiate to buyer-accept to
 * seller-pay without any admin approval step; the only admin action at
 * all is reversal, and only after completion.
 */
export default async function OwnershipTransfersPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const showingHistory = sp.history === "1";

  const statuses = showingHistory ? ["expired", "canceled", "reversed"] : ["pending", "awaiting_payment", "completed"];
  const { data: rows, error } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, buyer_email, status, created_at, completed_at")
    .in("status", statuses)
    .order("created_at", { ascending: false });

  const transfers = (rows ?? []) as TransferRow[];
  const inProgress = transfers.filter((t) => t.status === "pending" || t.status === "awaiting_payment");
  const completed = transfers.filter((t) => t.status === "completed");

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/ownership-transfers" />
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Admin
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              Ownership transfers
            </h1>
            <p className="mt-2 max-w-2xl font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Seller initiates, buyer accepts, seller pays the transfer fee — no admin approval in that path.
              Reversal is the only admin action, and only after completion.
            </p>
          </div>
          <Link
            href={showingHistory ? "/admin/ownership-transfers" : "/admin/ownership-transfers?history=1"}
            className="font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
          >
            {showingHistory ? "Show active" : "Show expired/canceled/reversed"}
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t load transfers: {error.message}
            </p>
          </div>
        ) : showingHistory ? (
          transfers.length === 0 ? (
            <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">No history yet.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {transfers.map((t) => (
                <div key={t.id} className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
                  <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                    {t.mxe_id} · {t.buyer_email}
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                    {TRANSFER_STATUS_LABELS[t.status]}
                  </p>
                  <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                    Initiated {new Date(t.created_at).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )
        ) : (
          <>
            <section className="mb-8">
              <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
                In progress
              </p>
              {inProgress.length === 0 ? (
                <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
                  <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                    No transfers in progress.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {inProgress.map((t) => (
                    <div key={t.id} className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
                      <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                        {t.mxe_id} · {t.buyer_email}
                      </p>
                      <p className="mt-1 font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.08em] text-[var(--text3)]">
                        {TRANSFER_STATUS_LABELS[t.status]}
                      </p>
                      <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                        Initiated {new Date(t.created_at).toLocaleString()}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section>
              <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
                Completed
              </p>
              {completed.length === 0 ? (
                <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
                  <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                    No completed transfers.
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-3">
                  {completed.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm"
                    >
                      <div>
                        <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                          {t.mxe_id} · {t.buyer_email}
                        </p>
                        <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                          Completed {t.completed_at ? new Date(t.completed_at).toLocaleString() : "—"}
                        </p>
                      </div>
                      <ReverseTransferButton transferId={t.id} mxeId={t.mxe_id} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
