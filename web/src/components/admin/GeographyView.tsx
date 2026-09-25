import Link from "next/link";
import { AdminNav } from "@/components/AdminNav";
import { StateRegionMap } from "@/components/admin/StateRegionMap";
import type { Geography } from "@/lib/geography";

/** The /admin/geography page body, given the summary and the chosen tab. */
export function GeographyView({ geo, stateParam }: { geo: Geography; stateParam?: string }) {
  const tab = geo.states.find((s) => s.code === (stateParam ?? "").toUpperCase()) ?? geo.states[0];
  const outOfStateTotal = geo.outOfState.reduce((n, s) => n + s.count, 0);

  const h2 = "font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]";
  const card = "rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 shadow-sm";
  const row =
    "flex items-center justify-between border-b border-[var(--divider)] py-2 font-[family-name:var(--font-dm)] text-sm text-[var(--navy)] last:border-b-0";

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-3xl">
        <AdminNav current="/admin/geography" />
        <header className="mb-5">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">Admin</p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">Geography</h1>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {geo.counted} paid, active {geo.counted === 1 ? "vessel" : "vessels"} (decommissioned excluded), placed by the ZIP
            where each is kept.
          </p>
        </header>

        <nav className="mb-4 flex gap-1 border-b border-[var(--divider)]" aria-label="State">
          {geo.states.map((s) => (
            <Link
              key={s.code}
              href={`/admin/geography?state=${s.code}`}
              aria-current={s.code === tab.code ? "page" : undefined}
              className={`-mb-px border-b-2 px-4 py-2 font-[family-name:var(--font-dm)] text-sm ${
                s.code === tab.code
                  ? "border-[var(--navy)] font-semibold text-[var(--navy)]"
                  : "border-transparent text-[var(--text2)] hover:text-[var(--navy)]"
              }`}
            >
              {s.label} <span className="text-[var(--text3)]">{s.total}</span>
            </Link>
          ))}
        </nav>

        <section className={`mb-8 ${card}`}>
          <div className="grid gap-6 sm:grid-cols-2 sm:items-center">
            <StateRegionMap stateCode={tab.code as "CA" | "FL" | "WA"} stateLabel={tab.label} regions={tab.regions} />
            <ol>
              {tab.regions.map((r) => (
                <li key={r.key} className={row}>
                  <span>{r.label}</span>
                  <span className="font-semibold">{r.count}</span>
                </li>
              ))}
              <li className={row}>
                <span className="text-[var(--text2)]">{tab.label}: other regions</span>
                <span className="font-semibold">{tab.otherRegions}</span>
              </li>
            </ol>
          </div>
        </section>

        <section className={`mb-8 ${card}`}>
          <div className="mb-3 flex items-baseline justify-between">
            <p className={h2}>Out of state</p>
            <span className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">{outOfStateTotal}</span>
          </div>
          {geo.outOfState.length === 0 ? (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              None — every vessel with a ZIP is kept in California, Florida or Washington.
            </p>
          ) : (
            <ol>
              {geo.outOfState.map((s) => (
                <li key={s.code} className={row}>
                  <span>{s.label}</span>
                  <span className="font-semibold">{s.count}</span>
                </li>
              ))}
            </ol>
          )}
        </section>

        <section className={card}>
          <div className="mb-1 flex items-baseline justify-between">
            <p className={h2}>Missing ZIP</p>
            <span className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">{geo.missingZip.length}</span>
          </div>
          <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            Not counted above. Owners add the ZIP the next time they save their Storage section.
          </p>
          {geo.missingZip.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline">
                View raw entries
              </summary>
              <ul className="mt-2 flex flex-col gap-1 border-l border-[var(--divider)] pl-3">
                {geo.missingZip.map((v) => (
                  <li key={v.mxe_id} className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
                    <span className="font-semibold text-[var(--navy)]">{v.mxe_id}</span>
                    {v.vessel_name ? ` ${v.vessel_name}` : ""}: {v.rawLocation ?? "(no location entered)"}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      </main>
    </div>
  );
}
