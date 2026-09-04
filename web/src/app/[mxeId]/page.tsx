import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { ScanSuccess } from "@/components/ScanSuccess";
import { VesselPublicProfile, type PublicProfileProps } from "@/components/VesselPublicProfile";
import { VesselOwnerProfile, type OwnerProfileTier } from "@/components/VesselOwnerProfile";
import type { ActiveTransfer } from "@/components/vessel-edit/TransferOwnershipPanel";
import { SharedVesselProfile } from "@/components/share/SharedVesselProfile";
import { fetchVesselByMxeId, filterVesselForRole } from "@/lib/vessel-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { emailsMatch, getOwnerEmailByUserId } from "@/lib/owner-verify";
import { getOwnerBillingSummary } from "@/lib/billing-service";
import { resolveShareByToken } from "@/lib/share-resolve";
import { getDormantInfo, DORMANT_PUBLIC_COPY } from "@/lib/vessel-dormancy";

const MXE_RE = /^MXE-\d{5}$/i;

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
            Link <em className="text-[var(--gold)] not-italic">no longer active.</em>
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
      />
    );
  }

  if (!MXE_RE.test(mxeId.trim())) {
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
    const reconcileService = createSupabaseServiceClient();
    if (reconcileService) {
      await reconcileService.rpc("reconcile_owner_dormancy", { p_owner_id: vessel.owner_id });
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
    let destinationRole: "owner" | "public" = "public";
    const scanSupabase = await createSupabaseServerClient();
    if (scanSupabase) {
      const {
        data: { user: scanUser },
      } = await scanSupabase.auth.getUser();
      if (scanUser?.email) {
        const scanOwnerEmail = await getOwnerEmailByUserId(vessel.owner_id);
        if (scanOwnerEmail && emailsMatch(scanUser.email, scanOwnerEmail)) {
          destinationRole = "owner";
        }
      }
    }
    return <ScanSuccess mxeId={vessel.mxe_id} destinationRole={destinationRole} />;
  }

  const roleParam = sp.role?.toLowerCase();

  if (roleParam === "owner") {
    const supabase = await createSupabaseServerClient();
    const nextUrl = `/${encodeURIComponent(vessel.mxe_id)}?role=owner`;

    if (!supabase) {
      redirect(`/login?next=${encodeURIComponent(nextUrl)}`);
    }

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
    let singleVessel = false;
    const service = createSupabaseServiceClient();
    if (service) {
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

      // Same owner-by-email-mismatch accommodation dashboard/page.tsx
      // uses (see lib/admin-verify.ts's requireAdmin() comment) —
      // singleVessel drives the automatic-caching default (build spec
      // §8 decision 2), so it has to count against both possible ids,
      // not just vessel.owner_id, or a mismatched account would always
      // read as "single vessel."
      const ownerIds = [vessel.owner_id];
      const normalizedEmail = user?.email?.trim().toLowerCase();
      if (normalizedEmail) {
        const { data: ownerByEmailRow } = await service
          .from("users")
          .select("id")
          .eq("email", normalizedEmail)
          .maybeSingle();
        const ownerByEmail = ownerByEmailRow as { id: string } | null;
        if (ownerByEmail?.id && !ownerIds.includes(ownerByEmail.id)) {
          ownerIds.push(ownerByEmail.id);
        }
      }
      const { count: activeVesselCount } = await service
        .from("vessels")
        .select("id", { count: "exact", head: true })
        .in("owner_id", ownerIds)
        .neq("lifecycle_status", "decommissioned");
      singleVessel = (activeVesselCount ?? 0) <= 1;
    }

    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <VesselOwnerProfile
          tier={tier}
          billing={billing}
          justUpgraded={sp.upgraded === "1"}
          hasPendingDecommissionRequest={hasPendingDecommissionRequest}
          activeTransfer={activeTransfer}
          singleVessel={singleVessel}
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
      </div>
    );
  }

  const tier = filterVesselForRole(vessel, "public") as PublicProfileProps;

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-5 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-display)] text-lg font-light italic text-white">
            <span className="text-[var(--gold)]">M</span>oxie
          </p>
          <span className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.45)]">
            Public
          </span>
        </div>
      </header>
      <VesselPublicProfile {...tier} />
    </div>
  );
}
