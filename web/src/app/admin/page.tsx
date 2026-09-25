import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-verify";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { decideHealth } from "@/lib/scheduler/health";
import { countedVesselsFilter, summarizeGeography, topRegions, type GeoVessel } from "@/lib/geography";
import { readBadgePoolStatus, POOL_AMBER_THRESHOLD, POOL_RED_THRESHOLD } from "@/lib/badge-pool";
import { notifyVesselsLapsedAfterPaymentFailure, notifyVesselsLocked } from "@/lib/dormancy-notify";

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function monthKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(d: Date) {
  return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

/**
 * Founder's-glance overview. Every number here is a real query against
 * the live tables — see the plan this was built from for the exact
 * definitions (in particular: "accounts" is scoped to role='owner',
 * excluding the admin's own row and any marina-operator rows, since
 * those don't hold vessels the way the "one account, up to a plan's
 * vessel cap" framing means). No revenue/MRR anywhere — that needs Stripe data
 * this page doesn't have yet, and an unverified number is worse than
 * no number.
 */
export default async function AdminOverviewPage() {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = requireSupabaseServiceClient("app/admin/page");
  // Dormant Vessel Identity: without a scheduled job, an owner who
  // lapses and never logs back in (and whose badge is never scanned)
  // would otherwise sit at lifecycle_status='active' indefinitely —
  // correct from their own session's point of view, but wrong for
  // anything reading state in bulk here. Reconciles every account with
  // an expired grace window before any count below is computed, so this
  // page self-heals on every load instead of drifting between visits.
  // Still not real-time — correct as of the last /admin load, not the
  // instant a grace period actually expires.
  const { data: pausedByOwner } = await service.rpc("reconcile_all_dormancy");
  // For an owner who never logs in and whose badge is never scanned, this
  // admin load is when their vessels pause — and so when they are told. One
  // row per owner and kind of event that THIS call caused; lapsed_ids is
  // absent before 20261003, which sends nothing for it.
  for (const row of (Array.isArray(pausedByOwner) ? pausedByOwner : []) as {
    owner_id: string;
    locked_ids?: string[];
    lapsed_ids?: string[];
  }[]) {
    await notifyVesselsLapsedAfterPaymentFailure(row.owner_id, row.lapsed_ids);
    await notifyVesselsLocked(row.owner_id, row.locked_ids);
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = startOfMonth(now);

  const [{ count: totalVessels }, { count: vesselsThisWeek }, { count: vesselsThisMonth }, { data: vesselDates }] =
    await Promise.all([
      // Paid, not decommissioned — the same rule as /admin/geography
      // (lib/geography.ts), so a vessel count means one thing across admin.
      // Was every row, including unpaid registrations and decommissioned boats.
      countedVesselsFilter(service.from("vessels").select("id", { count: "exact", head: true })),
      countedVesselsFilter(service.from("vessels").select("id", { count: "exact", head: true })).gte("created_at", weekAgo.toISOString()),
      countedVesselsFilter(service.from("vessels").select("id", { count: "exact", head: true })).gte("created_at", monthStart.toISOString()),
      countedVesselsFilter(service.from("vessels").select("created_at")).order("created_at", { ascending: true }),
    ]);

  const { data: ownerRows } = await service.from("users").select("subscription_tier").eq("role", "owner");
  const owners = (ownerRows ?? []) as { subscription_tier: string | null }[];
  const totalOwners = owners.length;
  const fullCount = owners.filter((o) => o.subscription_tier === "full").length;
  const basicCount = totalOwners - fullCount;

  // Monthly buckets from the earliest vessel through the current month —
  // real dataset is only a few months old, but capped at 12 buckets so
  // this doesn't grow into an unreadable strip years from now.
  const dates = (vesselDates ?? []).map((r) => new Date(r.created_at as string));
  const months: { key: string; label: string; count: number }[] = [];
  if (dates.length > 0) {
    const cursor = startOfMonth(dates[0]);
    const end = startOfMonth(now);
    while (cursor <= end && months.length < 12) {
      months.push({ key: monthKey(cursor), label: monthLabel(cursor), count: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    const countByKey = new Map(months.map((m) => [m.key, m]));
    for (const d of dates) {
      const bucket = countByKey.get(monthKey(startOfMonth(d)));
      if (bucket) bucket.count += 1;
    }
  }
  const maxMonthCount = Math.max(1, ...months.map((m) => m.count));

  // Identical filters to the pages these link into, so the counts here
  // always match what you'd see by clicking through.
  const { count: pendingStickers } = await service
    .from("vessels")
    .select("id", { count: "exact", head: true })
    .eq("qr_status", "active")
    .neq("sticker_order_status", "shipped");

  const { count: pendingCorrections } = await service
    .from("vessel_identity_correction_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  const { count: pendingDecommissions } = await service
    .from("vessel_decommission_requests")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending");

  // §3.2's low-water alarm. Wanted BEFORE the first batch ships, because
  // the failure it warns about is silent: an empty pool does not stop
  // signup, it quietly reverts to hand-printing one badge at a time,
  // which is the thing this whole change exists to end.
  const pool = await readBadgePoolStatus(service);

  const ratioFullPct = totalOwners > 0 ? Math.round((fullCount / totalOwners) * 100) : 0;

  // Compact geography summary; the full breakdown is /admin/geography.
  const { data: geoRows, error: geoError } = await countedVesselsFilter(
    service
      .from("vessels")
      .select("mxe_id, vessel_name, storage_state, storage_zip, storage_county, storage_city, storage_description, marina_name, marina_city"),
  );
  if (geoError) throw new Error(`vessels read failed: ${geoError.message}`);
  const geo = summarizeGeography((geoRows ?? []) as GeoVessel[]);
  const leadingRegions = topRegions(geo, 3);

  // Scheduler health (spec §7): the same rule the uptime monitor polls.
  const { data: latestRunRow, error: latestRunError } = await service
    .from("scheduler_runs")
    .select("status, finished_at")
    .not("finished_at", "is", null)
    .order("finished_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const schedulerHealth = latestRunError
    ? { healthy: false, reason: latestRunError.code === "PGRST205" ? "scheduler migration 20261004 not run" : "couldn't read scheduler runs" }
    : decideHealth((latestRunRow as { status: string; finished_at: string } | null) ?? null, new Date());

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin" />

        {!schedulerHealth.healthy ? (
          <div className="mb-6 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Scheduler not healthy: {schedulerHealth.reason}.{" "}
              <Link href="/admin/scheduler" className="underline">
                Open the scheduler
              </Link>
            </p>
          </div>
        ) : null}

        <header className="mb-8">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Admin
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Overview
          </h1>
        </header>

        {/* 1. Headline: vessels + accounts */}
        <section className="mb-8 rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 shadow-sm">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
                Paid, active vessels
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-6xl font-light text-[var(--navy)]">
                {totalVessels ?? 0}
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--aqua-lagoon)]">
                +{vesselsThisWeek ?? 0} this week &nbsp;·&nbsp; +{vesselsThisMonth ?? 0} this month
              </p>
            </div>
            <div className="text-right">
              <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
                Owner accounts
              </p>
              <p className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
                {totalOwners}
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                2 (Basic) or 5 (Full) vessels each
              </p>
            </div>
          </div>
        </section>

        {/* 2. Account breakdown */}
        <section className="mb-8 rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 shadow-sm">
          <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Basic vs. Full Access
          </p>
          <div className="mb-3 flex items-center justify-between font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
            <span>{basicCount} Basic</span>
            <span>{fullCount} Full Access</span>
          </div>
          <div className="h-3 w-full overflow-hidden rounded-full bg-[var(--cream2)]">
            <div className="h-full bg-[var(--gold)]" style={{ width: `${ratioFullPct}%` }} />
          </div>
          {totalOwners === 0 ? (
            <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">No owner accounts yet.</p>
          ) : null}
        </section>

        {/* 3. Signups over time */}
        <section className="mb-8 rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 shadow-sm">
          <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            New vessel registrations by month (paid, active today)
          </p>
          {months.length === 0 ? (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">No paid, active vessels yet.</p>
          ) : (
            <>
              {/* Fixed-height bar row: children default to align-items:stretch
                  (no items-end here, which would otherwise block that
                  stretch and collapse every child to 0 height, taking the
                  percentage-height bars inside them down to 0 too — the
                  bug this replaced). Each column then pushes its own bar
                  to the bottom via justify-end on its own column axis. */}
              <div className="flex h-[140px] gap-3">
                {months.map((m) => (
                  <div key={m.key} className="flex flex-1 flex-col justify-end">
                    <div
                      className="w-full rounded-t-md bg-[var(--aqua-bright)]"
                      style={{ height: `${Math.max(4, (m.count / maxMonthCount) * 100)}%` }}
                      title={`${m.count} in ${m.label}`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex gap-3">
                {months.map((m) => (
                  <div key={m.key} className="flex-1 text-center">
                    <p className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">{m.count}</p>
                    <p className="font-[family-name:var(--font-dm)] text-[11px] uppercase text-[var(--text3)]">
                      {m.label}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* Compact summary only — the maps, per-state tabs, out-of-state
            list and missing-ZIP entries live on /admin/geography. */}
        <Link
          href="/admin/geography"
          className="mb-8 block rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 shadow-sm transition hover:border-[var(--gold-line)]"
        >
          <p className="mb-3 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Where vessels are kept
          </p>
          {leadingRegions.length === 0 ? (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">No vessel has a storage ZIP yet.</p>
          ) : (
            <ol className="flex flex-col gap-1">
              {leadingRegions.map((r) => (
                <li
                  key={`${r.stateCode}-${r.label}`}
                  className="flex items-center justify-between font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]"
                >
                  <span>
                    {r.label} <span className="text-[var(--text3)]">{r.stateCode}</span>
                  </span>
                  <span className="font-semibold">{r.count}</span>
                </li>
              ))}
            </ol>
          )}
          <p className="mt-3 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            {geo.missingZip.length} missing ZIP · <span className="text-[var(--blue-fg)] underline">Geography →</span>
          </p>
        </Link>

        {/* 4. Needs attention */}
        {/* Above "Needs attention" rather than inside it, because it is
            not a queue with items to work through — it is a level that
            has to stay off the floor, and it reads wrong sitting beside
            three counts of pending requests. Hidden entirely until stock
            has ever existed, so it does not shout on a system that has
            not minted a batch yet. */}
        {pool.stockSince ? (
          <section className="mb-8">
            <Link
              href="/admin/badges"
              className={`block rounded-2xl border p-5 shadow-sm transition ${
                pool.level === "ok"
                  ? "border-[var(--divider)] bg-[var(--white)] hover:border-[var(--gold-line)]"
                  : pool.level === "amber"
                    ? "border-[var(--amber-fg)] bg-[var(--amber-bg)]"
                    : "border-[var(--red-fg)] bg-[var(--red-bg)]"
              }`}
            >
              <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
                Badge pool
              </p>
              <p
                className={`mt-1 font-[family-name:var(--font-display)] text-4xl font-light ${
                  pool.level === "ok"
                    ? "text-[var(--navy)]"
                    : pool.level === "amber"
                      ? "text-[var(--amber-fg)]"
                      : "text-[var(--red-fg)]"
                }`}
              >
                {pool.available} identities in stock
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                {pool.level === "empty"
                  ? "Empty — every new registration is now minting on demand and needs its badge printed individually. →"
                  : pool.level === "red"
                    ? `Below ${POOL_RED_THRESHOLD}. Mint and print the next batch now. →`
                    : pool.level === "amber"
                      ? `Below ${POOL_AMBER_THRESHOLD}. Start the next batch — printing takes days, not minutes. →`
                      : "Assignable to new registrations →"}
              </p>
              {/* §1.6: two physical badges per identity. Saying so here is
                  what stops the number reading as twice the safety it is. */}
              <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                Identities, not badges — each ships as two copies.
              </p>
            </Link>
          </section>
        ) : null}

        <section>
          <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Needs attention
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <Link
              href="/admin/stickers"
              className="block rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm transition hover:border-[var(--gold-line)]"
            >
              <p className="font-[family-name:var(--font-display)] text-4xl font-light text-[var(--navy)]">
                {pendingStickers ?? 0}
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                Pending sticker orders →
              </p>
            </Link>
            <Link
              href="/admin/vessel-correction-requests"
              className="block rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm transition hover:border-[var(--gold-line)]"
            >
              <p className="font-[family-name:var(--font-display)] text-4xl font-light text-[var(--navy)]">
                {pendingCorrections ?? 0}
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                Open correction requests →
              </p>
            </Link>
            <Link
              href="/admin/vessel-decommission-requests"
              className="block rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm transition hover:border-[var(--gold-line)]"
            >
              <p className="font-[family-name:var(--font-display)] text-4xl font-light text-[var(--navy)]">
                {pendingDecommissions ?? 0}
              </p>
              <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                Pending decommission requests →
              </p>
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
