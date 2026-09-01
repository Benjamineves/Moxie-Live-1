import { redirect } from "next/navigation";
import Link from "next/link";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";

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
 * those don't hold vessels the way the "one account, up to 5 vessels"
 * framing means). No revenue/MRR anywhere — that needs Stripe data
 * this page doesn't have yet, and an unverified number is worse than
 * no number.
 */
export default async function AdminOverviewPage() {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = startOfMonth(now);

  const [{ count: totalVessels }, { count: vesselsThisWeek }, { count: vesselsThisMonth }, { data: vesselDates }] =
    await Promise.all([
      service.from("vessels").select("id", { count: "exact", head: true }),
      service.from("vessels").select("id", { count: "exact", head: true }).gte("created_at", weekAgo.toISOString()),
      service.from("vessels").select("id", { count: "exact", head: true }).gte("created_at", monthStart.toISOString()),
      service.from("vessels").select("created_at").order("created_at", { ascending: true }),
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

  const ratioFullPct = totalOwners > 0 ? Math.round((fullCount / totalOwners) * 100) : 0;

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin" />

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
                Total registered vessels
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
                up to 5 vessels each
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
            New vessel registrations by month
          </p>
          {months.length === 0 ? (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">No vessels registered yet.</p>
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
                    <p className="font-[family-name:var(--font-dm)] text-[10px] text-[var(--text3)]">{m.count}</p>
                    <p className="font-[family-name:var(--font-dm)] text-[10px] uppercase text-[var(--text3)]">
                      {m.label}
                    </p>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>

        {/* 4. Needs attention */}
        <section>
          <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
            Needs attention
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
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
          </div>
        </section>
      </main>
    </div>
  );
}
