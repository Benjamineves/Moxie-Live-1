import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ScanSuccess } from "@/components/ScanSuccess";
import { AppHeader } from "@/components/AppHeader";
import { VesselPublicProfile, type PublicProfileProps } from "@/components/VesselPublicProfile";
import { VesselOwnerProfile, type OwnerProfileTier } from "@/components/VesselOwnerProfile";
import type { ActiveTransfer } from "@/components/vessel-edit/TransferOwnershipPanel";
import { SharedVesselProfile } from "@/components/share/SharedVesselProfile";
import { fetchVesselByMxeId, filterVesselForRole } from "@/lib/vessel-service";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { emailsMatch, getOwnerEmailByUserId } from "@/lib/owner-verify";
import { getOwnerBillingSummary } from "@/lib/billing-service";
import { resolveShareByToken } from "@/lib/share-resolve";
import { getDormantInfo, DORMANT_PUBLIC_COPY } from "@/lib/vessel-dormancy";
import { MARKETING_ORIGIN } from "@/lib/site-domains";
import { notifyOwnerDormancyResult } from "@/lib/dormancy-notify";
// Shared with not-found.tsx, which decides between the vessel wording and
// the generic one by asking this same question of the path.
import { looksLikeMxeId } from "@/lib/mxe-id";
import { loadVesselMarinaAccess, resolveMarinaViewer } from "@/lib/marina-access";
import { buildMarinaView, buildMarinaDormantView } from "@/lib/marina-view";
import { MarinaEmergencyContact, MarinaNotSharedBanner, MarinaVesselProfile } from "@/components/marina/MarinaVesselProfile";

type Props = {
  params: Promise<{ mxeId: string }>;
  searchParams: Promise<{ scan?: string; role?: string; upgraded?: string; share?: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { mxeId } = await params;
  const vessel = await fetchVesselByMxeId(mxeId);
  if (!vessel) return { title: "Vessel not found · Moxie" };
  return {
    title: `${vessel.vessel_name} · ${vessel.mxe_id}`,
    description: vessel.public_notes ?? `Registered vessel ${vessel.mxe_id}`,
  };
}

export default async function VesselPage({ params, searchParams }: Props) {
  const { mxeId } = await params;
  const sp = await searchParams;

  // Trusted Contact share link (docs/moxie_digital_technical_spec_share_profile.md
  // §5/§7). Resolved by token alone, independent of the vessel lookup
  // below — the mxeId in the URL is cosmetic for a share link (matches
  // whatever vessel the token was issued for; the spec's own resolve
  // endpoint doesn't take an mxeId at all), so this branch runs before
  // — and instead of — the ordinary MXE-ID validation/fetch/notFound
  // path that every other view on this page depends on.
  if (sp.share) {
    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const result = await resolveShareByToken(sp.share, ip);

    if ("error" in result) {
      return (
        <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--cream)] px-6 text-center">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Link <em className="text-[var(--gold-deep)] not-italic">no longer active.</em>
          </h1>
          <p className="max-w-sm font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            This share link has expired, been revoked, or already been used.
          </p>
        </div>
      );
    }

    return (
      <SharedVesselProfile
        vessel={result.vessel}
        sharedBy={result.sharedBy}
        label={result.label}
        expiresAt={result.expiresAt}
        serviceRecords={result.serviceRecords}
      />
    );
  }

  if (!looksLikeMxeId(mxeId)) {
    notFound();
  }

  const vessel = await fetchVesselByMxeId(mxeId);
  if (!vessel) {
    notFound();
  }

  // Dormant Vessel Identity (docs/moxie_digital_dormant_identity_spec.md):
  // both lazy grace-period checks (past-due -> lapsed, downgrade grace ->
  // locked fallback) for this vessel's owner, run opportunistically here
  // since there's no scheduled job to run them on a timer. Guarded to
  // qr_status='active' — an unborn (pending-payment) vessel was never
  // counted as active in the first place, so there's nothing to
  // reconcile. Re-reads lifecycle_status/dormant_cause afterward since
  // this call can change them for the very vessel being rendered.
  if (vessel.qr_status === "active") {
    // Was `if (reconcileService)`, which silently skipped the reconcile and
    // rendered the vessel's stale status — a lapsed vessel shown as active
    // on a stranger's badge scan. A missing service role is ours to fix.
    const reconcileService = requireSupabaseServiceClient("app/[mxeId]/page reconcile");
    const { data: dormancy } = await reconcileService.rpc("reconcile_owner_dormancy", { p_owner_id: vessel.owner_id });
    // This can be the moment vessels pause — for a failed payment or an
    // expired downgrade window — including on a stranger's badge scan. The
    // owner is told, once: the ids come back only to the call that paused
    // them, so the next scan finds nothing to report.
    await notifyOwnerDormancyResult(vessel.owner_id, dormancy);
    const { data: freshLifecycle } = await reconcileService
      .from("vessels")
      .select("lifecycle_status, dormant_cause")
      .eq("id", vessel.id)
      .maybeSingle();
    if (freshLifecycle) {
      const fresh = freshLifecycle as { lifecycle_status: string | null; dormant_cause: string | null };
      vessel.lifecycle_status = fresh.lifecycle_status;
      vessel.dormant_cause = fresh.dormant_cause;
    }
  }

  const scan = sp.scan === "1" || sp.scan === "true";
  if (scan) {
    // Real badge scans always carry ?scan=1 (encoded into the printed
    // badge by dashboard/[mxeId]/qr/page.tsx) — this is the PRIMARY
    // case, and the visitor is very often unauthenticated. Unlike the
    // role=owner branch below, this must never redirect to login: a
    // public scanner with no session is expected, not an error state.
    // Ownership only decides where the animation sends the visitor
    // AFTER it plays — the animation itself always plays, and a
    // positive owner match is required to land on ?role=owner; every
    // other outcome (no session, session that doesn't match, lookup
    // failure) silently falls back to ?role=public. Same
    // getOwnerEmailByUserId/emailsMatch check the role=owner branch
    // below uses — deliberately not a second implementation of it.
    let destinationRole: "owner" | "marina" | "public" = "public";
    // Same session-aware exit as the public header (moxie_digital_pwa_spec.md's
    // "No back button" section) — pending/decommissioned are terminal
    // states in ScanSuccess with no auto-redirect, so they need their own
    // way out. Computed from the same auth.getUser() call as
    // destinationRole above, not a second lookup.
    let exitHref: string = MARKETING_ORIGIN;
    const scanSupabase = await requireSupabaseServerClient("app/[mxeId]/page scan");
    const {
      data: { user: scanUser },
    } = await scanSupabase.auth.getUser();
    if (scanUser?.email) {
      exitHref = "/dashboard";
      const scanOwnerEmail = await getOwnerEmailByUserId(vessel.owner_id);
      if (scanOwnerEmail && emailsMatch(scanUser.email, scanOwnerEmail)) {
        destinationRole = "owner";
      } else {
        // A marina whose owner shared with them lands on the marina view.
        // Owner wins if one account is both. The landing page re-derives
        // this; the URL only says where to go.
        const scanViewer = await resolveMarinaViewer(
          requireSupabaseServiceClient("app/[mxeId]/page scan marina"),
          scanUser.email,
          vessel,
        );
        if (scanViewer.kind === "access") destinationRole = "marina";
      }
    }
    return <ScanSuccess mxeId={vessel.mxe_id} destinationRole={destinationRole} exitHref={exitHref} />;
  }

  const roleParam = sp.role?.toLowerCase();

  if (roleParam === "owner") {
    const supabase = await requireSupabaseServerClient("app/[mxeId]/page role=owner");
    const nextUrl = `/${encodeURIComponent(vessel.mxe_id)}?role=owner`;

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user?.email) {
      redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }

    const ownerEmail = await getOwnerEmailByUserId(vessel.owner_id);

    if (!ownerEmail) {
      return (
        <div className="min-h-screen bg-[var(--cream)] px-6 py-16">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Cannot verify ownership
          </h1>
          <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Add <code className="rounded bg-[var(--cream2)] px-1 text-xs">SUPABASE_SERVICE_ROLE_KEY</code>{" "}
            to the server environment (never expose as NEXT_PUBLIC), or allow reading{" "}
            <code className="text-xs">public.users</code> for this check.
          </p>
        </div>
      );
    }

    if (!emailsMatch(user.email, ownerEmail)) {
      return (
        <div className="min-h-screen bg-[var(--cream)] px-6 py-16">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Wrong account
          </h1>
          <p className="mt-4 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Sign in as the vessel owner ({ownerEmail}) to view this tier.
          </p>
        </div>
      );
    }

    const tier = filterVesselForRole(vessel, "owner") as OwnerProfileTier;
    const billing = (await getOwnerBillingSummary(vessel.owner_id)) ?? {
      subscriptionTier: "basic" as const,
      subscriptionStatus: null,
      payments: [],
    };

    let hasPendingDecommissionRequest = false;
    let activeTransfer: ActiveTransfer | null = null;
    const service = requireSupabaseServiceClient("app/[mxeId]/page owner-extras");
    const { data: pendingRequest } = await service
      .from("vessel_decommission_requests")
      .select("id")
      .eq("vessel_id", vessel.id)
      .eq("status", "pending")
      .maybeSingle();
    hasPendingDecommissionRequest = !!pendingRequest;

    const { data: transferRow } = await service
      .from("ownership_transfers")
      .select("id, status, buyer_email, expires_at")
      .eq("vessel_id", vessel.id)
      .in("status", ["pending", "awaiting_payment"])
      .maybeSingle();
    if (transferRow) {
      const t = transferRow as { id: string; status: string; buyer_email: string; expires_at: string };
      activeTransfer = {
        id: t.id,
        status: t.status as "pending" | "awaiting_payment",
        buyerEmail: t.buyer_email,
        expiresAt: t.expires_at,
      };
    }

    const marinaAccess = (await loadVesselMarinaAccess(service, [vessel.id])).map((g) => ({
      id: g.id,
      marinaName: g.marina.name,
      marinaCity: g.marina.city,
      share_registration: g.share_registration,
      share_insurance: g.share_insurance,
    }));

    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <VesselOwnerProfile
          tier={tier}
          billing={billing}
          justUpgraded={sp.upgraded === "1"}
          hasPendingDecommissionRequest={hasPendingDecommissionRequest}
          activeTransfer={activeTransfer}
          marinaAccess={marinaAccess}
        />
      </div>
    );
  }

  // Payment gate (build spec §5, P0-A acceptance tests), checked FIRST
  // among the state gates (dormant identity spec §7.2): a vessel that
  // hasn't cleared payment doesn't get a live public profile at all — the
  // intake flow ends at qr_status='pending_payment', and only the Stripe
  // webhook ever flips it. A pending-payment vessel is not dormant, it's
  // unborn — it can never reach the dormant dispatch below. MXE-00004 is
  // the fixture that exercises this.
  if (vessel.qr_status !== "active") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--cream)] px-6 text-center">
        <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">
          {vessel.mxe_id}
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
          Not yet active
        </h1>
        <p className="max-w-sm font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          This vessel&apos;s registration hasn&apos;t been completed yet — there&apos;s no live profile to show.
        </p>
      </div>
    );
  }

  // Who is looking, resolved once for everything below: the dormant
  // screen, the marina view and the public header. A signed-out visitor —
  // the common case on a badge scan — costs no marina query at all.
  // ?role=marina is not read: access is re-derived here on every render.
  const viewerSupabase = await requireSupabaseServerClient("app/[mxeId]/page viewer");
  const {
    data: { user: viewerUser },
  } = await viewerSupabase.auth.getUser();
  const marinaViewer = viewerUser?.email
    ? await resolveMarinaViewer(requireSupabaseServiceClient("app/[mxeId]/page marina"), viewerUser.email, vessel)
    : ({ kind: "none" } as const);

  // Dormant Vessel Identity: one shared dispatch for all three causes
  // (lapsed, locked, decommissioned) — getDormantInfo() is the single
  // place that turns lifecycle_status/dormant_cause into one answer.
  // Retained identity fields (§3) still render here so the scan stays
  // informative; nothing in the suspended list (documents, sharing,
  // owner contact) is ever reachable on this path — this returns before
  // filterVesselForRole is called, so no tier object with that data even
  // exists here.
  const dormant = getDormantInfo(vessel);
  if (dormant.isDormant && dormant.cause) {
    const copy = DORMANT_PUBLIC_COPY[dormant.cause];
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--cream)] px-6 text-center">
        {vessel.photo_url?.startsWith("http") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={vessel.photo_url}
            alt={vessel.vessel_name}
            className="h-32 w-32 rounded-full object-cover opacity-80 grayscale"
          />
        ) : null}
        <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">
          {vessel.mxe_id}
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
          {vessel.vessel_name}
        </h1>
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">
          {[vessel.year, vessel.make, vessel.model].filter(Boolean).join(" ")}
        </p>
        <div className="mt-2 max-w-sm rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
          <p className="font-[family-name:var(--font-display)] text-xl font-light italic text-[var(--navy)]">
            {copy.headline}
          </p>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">{copy.body}</p>
          {dormant.cause === "decommissioned" ? (
            <a
              href="mailto:hello@moxieyachting.com"
              className="mt-4 inline-flex rounded-lg bg-[var(--navy)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)]"
            >
              {copy.ctaLabel}
            </a>
          ) : (
            <Link
              href={`/login?next=${encodeURIComponent(`/${vessel.mxe_id}?role=owner`)}`}
              className="mt-4 inline-flex rounded-lg bg-[var(--navy)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)]"
            >
              {copy.ctaLabel}
            </Link>
          )}
        </div>
        {/* A marina with access keeps the emergency contact while the
            vessel is lapsed or locked, and nothing else (spec §4.2): the
            need to reach someone is highest when the owner has
            disengaged. Decommissioned vessels never reach here with
            access — decideMarinaViewer excludes them. */}
        {marinaViewer.kind === "access" ? (
          <div className="w-full max-w-sm text-left">
            <MarinaEmergencyContact emergency={buildMarinaDormantView(vessel).emergency} />
          </div>
        ) : null}
      </div>
    );
  }

  if (marinaViewer.kind === "access") {
    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <AppHeader role="Marina" wordmarkHref="/dashboard" />
        <MarinaVesselProfile view={buildMarinaView(vessel, marinaViewer.access)} marinaName={marinaViewer.marina.name} />
      </div>
    );
  }

  const tier = filterVesselForRole(vessel, "public") as PublicProfileProps;

  // Session-aware header destination (moxie_digital_pwa_spec.md's "No
  // back button" section) — the standalone PWA has no browser chrome to
  // fall back on, so the wordmark must go somewhere real. It reuses the
  // session read made for the marina decision above — a plain read, not a
  // redirect, so it's safe for the very common case of an unauthenticated
  // visitor (a stranger who scanned a dock badge has no dashboard to
  // bounce to — sending them to the marketing origin instead turns the
  // end of the path into a discovery surface rather than a dead end).
  const wordmarkHref = viewerUser ? "/dashboard" : MARKETING_ORIGIN;

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <AppHeader role="Public" wordmarkHref={wordmarkHref} />
      {marinaViewer.kind === "no_access" ? <MarinaNotSharedBanner marinaName={marinaViewer.marina.name} /> : null}
      <VesselPublicProfile {...tier} />
    </div>
  );
}
