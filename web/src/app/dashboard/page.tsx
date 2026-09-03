import Link from "next/link";
import { redirect } from "next/navigation";
import { PixelM } from "@/components/PixelM";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { requireAdmin } from "@/lib/admin-verify";
import { DeleteUnactivatedVesselButton } from "@/components/vessel-edit/DeleteUnactivatedVesselButton";
import { NotificationBanner } from "@/components/NotificationBanner";
import { getDormantInfo } from "@/lib/vessel-dormancy";
import type { VesselRecord } from "@/types/vessel";

async function signOutAction() {
  "use server";

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/login");
}

type Props = {
  searchParams: Promise<{ upgraded?: string }>;
};

export default async function DashboardPage({ searchParams }: Props) {
  const sp = await searchParams;
  const justUpgraded = sp.upgraded === "1";
  // Computed once, reused everywhere below — a Server Component's render
  // body must stay pure (no bare Date.now() calls inline, though `new
  // Date()` itself is fine — same pattern admin/page.tsx already uses),
  // and this also keeps every "days left" figure on the page consistent
  // with a single moment rather than drifting between two calls.
  const now = new Date().getTime();

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/login?next=/dashboard");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/login?next=/dashboard");
  }

  const ownerIds = [user.id];
  const normalizedEmail = user.email?.trim().toLowerCase();
  if (normalizedEmail) {
    const { data: ownerByEmailRow } = await service
      .from("users")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();
    const ownerByEmail = ownerByEmailRow as { id: string } | null;
    if (ownerByEmail?.id && ownerByEmail.id !== user.id) {
      ownerIds.push(ownerByEmail.id);
    }
  }

  // Dormant Vessel Identity: both lazy grace-period checks (past-due ->
  // lapsed, downgrade grace -> locked fallback), run here since this is
  // the owner's own dashboard load and there's no scheduled job to run
  // them on a timer — same reconciliation the public [mxeId] page also
  // triggers for whichever owner's vessel is being viewed.
  for (const ownerId of ownerIds) {
    await service.rpc("reconcile_owner_dormancy", { p_owner_id: ownerId });
  }

  const { data: vessels, error } = await service
    .from("vessels")
    .select("*")
    .in("owner_id", ownerIds)
    .order("created_at", { ascending: false });

  const ownedVessels = ((vessels ?? []) as VesselRecord[]).filter((v) => v.mxe_id);
  const activeFleet = ownedVessels.filter((v) => v.lifecycle_status !== "decommissioned");
  const archivedVessels = ownedVessels.filter((v) => v.lifecycle_status === "decommissioned");

  // Expiry reminders are in-app only (no email infrastructure exists in
  // this app) — a banner here, checked whenever the seller loads their
  // own dashboard, is the whole mechanism. 48h window is arbitrary but
  // reasonable against the 7-day expiry. Scoped by ownerIds (not just
  // user.id) for the same reason the vessels query above is — seller_id
  // on a transfer is set from vessel.owner_id at initiation, which can
  // be either id in the owner-by-email-mismatch case this app already
  // handles everywhere else.
  const { data: myTransferRows } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, buyer_email, status, expires_at")
    .in("seller_id", ownerIds)
    .in("status", ["pending", "awaiting_payment"])
    .order("expires_at", { ascending: true });
  const REMINDER_WINDOW_MS = 48 * 60 * 60 * 1000;
  const expiringTransfers = (
    (myTransferRows ?? []) as { id: string; mxe_id: string; buyer_email: string; status: string; expires_at: string }[]
  ).filter((t) => new Date(t.expires_at).getTime() - now < REMINDER_WINDOW_MS);

  const { data: previouslyOwnedRows } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, buyer_email, completed_at")
    .in("seller_id", ownerIds)
    .eq("status", "completed")
    .order("completed_at", { ascending: false });
  const previouslyOwned = (previouslyOwnedRows ?? []) as { id: string; mxe_id: string; buyer_email: string; completed_at: string }[];

  // Dormant Vessel Identity notifications — the one hook (lib/notify.ts
  // notifyOwner()) writes here; this is the one place they're read back
  // and rendered, as in-app banners, until an email provider exists.
  const { data: notificationRows } = await service
    .from("owner_notifications")
    .select("id, type, message, created_at")
    .in("owner_id", ownerIds)
    .is("read_at", null)
    .order("created_at", { ascending: false });
  const notifications = (notificationRows ?? []) as { id: string; type: string; message: string; created_at: string }[];

  const lockedVessels = ownedVessels.filter((v) => v.lifecycle_status === "dormant" && v.dormant_cause === "locked");

  // Server-checked, not CSS-hidden — requireAdmin() re-verifies role +
  // the ADMIN_EMAILS allowlist independently of anything else on this
  // page, same as every other admin surface in the app. A non-admin
  // never receives this link in the rendered HTML at all.
  const admin = await requireAdmin();

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-4 py-3">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <Link href="/" className="flex items-center gap-2">
            <PixelM size={28} className="shrink-0" />
            <span className="font-[family-name:var(--font-display)] text-xl font-light italic text-white">
              <span className="text-[var(--gold)]">M</span>oxie
            </span>
          </Link>
          <div className="flex items-center gap-3">
            <span className="hidden font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.75)] sm:block">
              {user.email}
            </span>
            {admin ? (
              <Link
                href="/admin"
                className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)] hover:underline"
              >
                Admin
              </Link>
            ) : null}
            <form action={signOutAction}>
              <button
                type="submit"
                className="rounded-md border border-[var(--gold)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.12em] text-[var(--gold)]"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        {justUpgraded ? (
          <div className="mb-6 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] px-4 py-3">
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">
              You&apos;re on Full Access — every vessel on this account is covered.
            </p>
          </div>
        ) : null}

        <NotificationBanner notifications={notifications} />

        {lockedVessels.length > 0 ? (
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] px-4 py-3">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              {`${lockedVessels.length} vessel${lockedVessels.length === 1 ? " is" : "s are"} dormant — beyond your Basic plan's vessel limit. Nothing's deleted; choose which stay active, or upgrade to Full to restore all of them.`}
            </p>
            <div className="flex shrink-0 gap-2.5">
              <Link
                href="/dashboard/manage-fleet"
                className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--red-fg)] underline"
              >
                Choose active vessels →
              </Link>
              <Link
                href="/dashboard/upgrade"
                className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--red-fg)] underline"
              >
                Upgrade →
              </Link>
            </div>
          </div>
        ) : null}

        {expiringTransfers.length > 0 ? (
          <div className="mb-6 flex flex-col gap-2">
            {expiringTransfers.map((t) => {
              const daysLeft = Math.ceil((new Date(t.expires_at).getTime() - now) / (24 * 60 * 60 * 1000));
              return (
                <div
                  key={t.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--red-fg)] bg-[var(--red-bg)] px-4 py-3"
                >
                  <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
                    Transfer of {t.mxe_id} to {t.buyer_email}{" "}
                    {t.status === "pending"
                      ? daysLeft > 0
                        ? `expires in ${daysLeft} day${daysLeft === 1 ? "" : "s"} — not yet accepted.`
                        : "expires today — not yet accepted."
                      : "is awaiting your transfer fee payment."}
                  </p>
                  <Link
                    href={`/${encodeURIComponent(t.mxe_id)}?role=owner`}
                    className="shrink-0 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--red-fg)] underline"
                  >
                    Manage transfer →
                  </Link>
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Owner dashboard
            </p>
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              Your vessels
            </h1>
          </div>
          <Link
            href="/dashboard/new"
            className="rounded-lg bg-[var(--aqua-bright)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy-deep)]"
          >
            Register vessel
          </Link>
        </div>

        {error ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t load your vessels: {error.message}
            </p>
          </div>
        ) : null}

        {!error && activeFleet.length === 0 && archivedVessels.length === 0 ? (
          <section className="rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <h2 className="font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
              No vessels yet
            </h2>
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Start your onboarding flow to get your MXE ID and printable QR sticker.
            </p>
            <Link
              href="/dashboard/new"
              className="mt-6 inline-flex rounded-lg bg-[var(--aqua-bright)] px-5 py-3 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy-deep)]"
            >
              Register your first vessel →
            </Link>
          </section>
        ) : null}

        {activeFleet.length > 0 ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {activeFleet.map((vessel) => {
              const needsActivation = vessel.qr_status !== "active";
              const dormant = getDormantInfo(vessel);
              return (
                <article
                  key={vessel.id}
                  className={`overflow-hidden rounded-2xl border bg-[var(--white)] shadow-sm ${
                    needsActivation || dormant.isDormant ? "border-[var(--red-fg)]" : "border-[var(--divider)]"
                  }`}
                >
                  <div className="aspect-[16/10] bg-[var(--cream2)]">
                    {vessel.photo_url?.startsWith("http") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={vessel.photo_url} alt={vessel.vessel_name} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-4xl text-[var(--gold)]">⚓</div>
                    )}
                  </div>
                  <div className="p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="inline-flex rounded-full bg-[var(--gold-dim)] px-2.5 py-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--navy)]">
                        {vessel.mxe_id}
                      </p>
                      {needsActivation ? (
                        <p className="inline-flex rounded-full bg-[var(--red-bg)] px-2.5 py-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--red-fg)]">
                          Needs activation
                        </p>
                      ) : dormant.isDormant ? (
                        <p className="inline-flex rounded-full bg-[var(--red-bg)] px-2.5 py-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--red-fg)]">
                          Dormant — {dormant.cause === "lapsed" ? "subscription lapsed" : "beyond plan limit"}
                        </p>
                      ) : null}
                    </div>
                    <h3 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
                      {vessel.vessel_name}
                    </h3>
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                      {vessel.make} {vessel.model} · {vessel.year}
                    </p>
                    {needsActivation ? (
                      <>
                        <p className="mt-3 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
                          Badge fee unpaid — no badge ships and no public profile until this is finished.
                        </p>
                        <Link
                          href={`/dashboard/${encodeURIComponent(vessel.mxe_id)}/payment`}
                          className="mt-4 inline-flex rounded-lg bg-[var(--red-fg)] px-4 py-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-white"
                        >
                          Finish activating →
                        </Link>
                        <div className="mt-2">
                          <DeleteUnactivatedVesselButton mxeId={vessel.mxe_id} vesselName={vessel.vessel_name} />
                        </div>
                      </>
                    ) : (
                      <div className="mt-4 flex flex-wrap gap-3">
                        <Link
                          href={`/${encodeURIComponent(vessel.mxe_id)}`}
                          className="font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline"
                        >
                          View public profile
                        </Link>
                        <Link
                          href={`/${encodeURIComponent(vessel.mxe_id)}?role=owner`}
                          className="font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline"
                        >
                          Manage
                        </Link>
                        <Link
                          href={`/dashboard/${encodeURIComponent(vessel.mxe_id)}/qr`}
                          className="font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline"
                        >
                          QR code
                        </Link>
                      </div>
                    )}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        {archivedVessels.length > 0 ? (
          <section className="mt-10">
            <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Archived
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {archivedVessels.map((vessel) => (
                <div
                  key={vessel.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--divider)] bg-[var(--cream2)] p-4"
                >
                  <div>
                    <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{vessel.mxe_id}</p>
                    <p className="font-[family-name:var(--font-display)] text-lg italic text-[var(--text2)]">
                      {vessel.vessel_name}
                    </p>
                  </div>
                  <Link
                    href={`/${encodeURIComponent(vessel.mxe_id)}?role=owner`}
                    className="shrink-0 font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {previouslyOwned.length > 0 ? (
          <section className="mt-10">
            <p className="mb-4 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Previously owned
            </p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {previouslyOwned.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-[var(--divider)] bg-[var(--cream2)] p-4"
                >
                  <div>
                    <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{t.mxe_id}</p>
                    <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                      Transferred {new Date(t.completed_at).toLocaleDateString()}
                    </p>
                  </div>
                  <Link
                    href={`/dashboard/transfer/${encodeURIComponent(t.id)}/previously-owned`}
                    className="shrink-0 font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
                  >
                    View →
                  </Link>
                </div>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}
