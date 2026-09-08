import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { MintBatchForm } from "./MintBatchForm";

type BatchRow = {
  id: string;
  label: string;
  minted_count: number;
  copies_per_identity: number;
  printed_count: number;
  qr_version: number;
  minted_at: string;
};

type IdentityRow = {
  print_batch_id: string | null;
  status: string;
  artwork_path: string | null;
};

const STATUS_ORDER = ["minted", "printed", "in_stock", "assigned", "void"] as const;

/**
 * Badge inventory — spec §5.2's batch view, and the home of the mint
 * operation (§5.0).
 *
 * Deliberately separate from /admin/stickers rather than folded into it.
 * That queue is driven entirely off `vessels`, and un-assigned inventory
 * has no vessel row by design (§2.1) — it is invisible there by
 * construction, not by accident, and bending that queue to show both
 * would undo the property that keeps warehouse stock out of every
 * existing vessel count.
 */
export default async function BadgeInventoryPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const service = createSupabaseServiceClient();
  if (!service) redirect("/dashboard");

  const { data: batchRows, error: batchError } = await service
    .from("badge_print_batches")
    .select("id, label, minted_count, copies_per_identity, printed_count, qr_version, minted_at")
    .order("minted_at", { ascending: false });
  const batches = (batchRows ?? []) as BatchRow[];

  // Aggregated client-side rather than in SQL. Fine at the scale this
  // actually runs at — a few hundred rows — and it avoids adding a view
  // for a page that stage 4 is about to change anyway. If inventory ever
  // reaches tens of thousands this wants to become a grouped view;
  // noting it here rather than pre-building for a scale that may never
  // arrive.
  const { data: identityRows } = await service
    .from("badge_identities")
    .select("print_batch_id, status, artwork_path");
  const identities = (identityRows ?? []) as IdentityRow[];

  const byBatch = new Map<string, IdentityRow[]>();
  for (const row of identities) {
    if (!row.print_batch_id) continue;
    const list = byBatch.get(row.print_batch_id);
    if (list) list.push(row);
    else byBatch.set(row.print_batch_id, [row]);
  }

  const totalIdentities = identities.length;
  const totalInStock = identities.filter((i) => i.status === "in_stock").length;

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/badges" />
        <header className="mb-6">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Admin
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Badge inventory
          </h1>
          <p className="mt-2 max-w-2xl font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Pre-minted identities, held as stock before any account exists. An identity becomes pickable only at{" "}
            <code>in_stock</code>; nothing here is assigned to a vessel until signup claims it.
          </p>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {totalIdentities} identities minted · <strong>{totalInStock} in stock</strong>
          </p>
        </header>

        <MintBatchForm />

        <section className="mt-10">
          <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Batches
          </p>

          {batchError ? (
            <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
                Couldn&apos;t load batches: {batchError.message}
              </p>
            </div>
          ) : batches.length === 0 ? (
            <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
              <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                No batches minted yet.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {batches.map((batch) => {
                const rows = byBatch.get(batch.id) ?? [];
                const rendered = rows.filter((r) => r.artwork_path !== null).length;
                const counts = STATUS_ORDER.map((status) => ({
                  status,
                  n: rows.filter((r) => r.status === status).length,
                })).filter((entry) => entry.n > 0);

                return (
                  <div
                    key={batch.id}
                    className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                          {batch.label}
                        </p>
                        <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                          {batch.minted_count} identities · {batch.printed_count} badges (
                          {batch.copies_per_identity}× each) · QR v{batch.qr_version} ·{" "}
                          {new Date(batch.minted_at).toLocaleString()}
                        </p>
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {counts.map(({ status, n }) => (
                            <span
                              key={status}
                              className="rounded-lg bg-[var(--blue-bg)] px-2 py-0.5 font-[family-name:var(--font-dm)] text-[9px] font-semibold uppercase tracking-[0.06em] text-[var(--blue-fg)]"
                            >
                              {n} {status.replace("_", " ")}
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
                          Artwork
                        </p>
                        {/* Progress is COUNT(*) WHERE artwork_path IS NOT NULL
                            against minted_count — the data itself, not a
                            job-status column that could go stale if a
                            render died (§5.0.5). Stage 4 adds the render;
                            until then this correctly reads 0. */}
                        <p
                          className={`font-[family-name:var(--font-dm)] text-sm font-semibold ${
                            rendered === batch.minted_count && rendered > 0
                              ? "text-[var(--green-fg)]"
                              : "text-[var(--text2)]"
                          }`}
                        >
                          {rendered} / {batch.minted_count}
                        </p>
                        {rendered < batch.minted_count ? (
                          <p className="font-[family-name:var(--font-dm)] text-[10px] text-[var(--text3)]">
                            not yet rendered
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
