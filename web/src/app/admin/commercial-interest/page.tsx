import { redirect } from "next/navigation";
import { AdminNav } from "@/components/AdminNav";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { BUSINESS_TYPE_LABELS, loadCommercialInterest } from "@/lib/commercial-interest";

/**
 * Who asked to hear when the commercial/broker tier opens. Newest first,
 * because the useful question is "who came in since I last looked".
 *
 * The list exists to be emailed once, later — hence the CSV export beside
 * the count rather than buried at the bottom.
 */
export default async function CommercialInterestPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const service = requireSupabaseServiceClient("app/admin/commercial-interest/page");
  const rows = await loadCommercialInterest(service);

  const byType = new Map<string, number>();
  for (const r of rows) byType.set(r.business_type ?? "not given", (byType.get(r.business_type ?? "not given") ?? 0) + 1);

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-3xl">
        <AdminNav current="/admin/commercial-interest" />
        <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Admin
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              Commercial interest
            </h1>
            <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              {rows.length === 0
                ? "Nobody yet."
                : `${rows.length} ${rows.length === 1 ? "person" : "people"} · ` +
                  [...byType.entries()].map(([t, n]) => `${n} ${BUSINESS_TYPE_LABELS[t as never] ?? t}`).join(" · ")}
            </p>
          </div>
          {rows.length > 0 ? (
            <a
              href="/admin/commercial-interest/export"
              className="rounded-lg bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
              download
            >
              Export CSV
            </a>
          ) : null}
        </header>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              The form on <code className="rounded bg-[var(--cream2)] px-1">/pricing</code> writes here. Nothing has
              come in yet.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-[var(--divider)] bg-[var(--white)]">
            {rows.map((r) => (
              <div key={r.email} className="flex flex-wrap items-baseline justify-between gap-2 border-b border-[var(--divider)] p-4 last:border-0">
                <div className="min-w-0">
                  <a
                    href={`mailto:${r.email}`}
                    className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)] underline underline-offset-2"
                  >
                    {r.email}
                  </a>
                  <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                    {(r.business_type ? BUSINESS_TYPE_LABELS[r.business_type] : "Business type not given") +
                      ` · from ${r.source_page}` +
                      (r.updated_at !== r.submitted_at ? ` · asked again ${new Date(r.updated_at).toLocaleDateString()}` : "")}
                  </p>
                </div>
                <p className="shrink-0 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                  {new Date(r.submitted_at).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
