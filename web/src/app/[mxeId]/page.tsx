import type { Metadata } from "next";
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

  const scan = sp.scan === "1" || sp.scan === "true";
  if (scan) {
    return <ScanSuccess mxeId={vessel.mxe_id} />;
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
    }

    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <VesselOwnerProfile
          tier={tier}
          billing={billing}
          justUpgraded={sp.upgraded === "1"}
          hasPendingDecommissionRequest={hasPendingDecommissionRequest}
          activeTransfer={activeTransfer}
        />
      </div>
    );
  }

  // Decommissioned vessels get their own terminal state, checked before
  // — and instead of — the qr_status gate below: someone may have
  // scanned an already-decommissioned badge (still on the hull), or the
  // vessel was decommissioned after it was activated. Don't expose owner
  // contact or documents here — this returns before filterVesselForRole
  // is ever called, so no tier object with that data even exists on this
  // path.
  if (vessel.lifecycle_status === "decommissioned") {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-[var(--cream)] px-6 text-center">
        <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">
          {vessel.mxe_id}
        </p>
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
          No longer <em className="text-[var(--gold)] not-italic">active.</em>
        </h1>
        <p className="max-w-sm font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          This vessel is no longer part of Moxie&apos;s active fleet.
        </p>
      </div>
    );
  }

  // Payment gate (build spec §5, P0-A acceptance tests): a vessel that
  // hasn't cleared payment doesn't get a live public profile — the intake
  // flow ends at qr_status='pending_payment', and only the Stripe webhook
  // ever flips it. MXE-00004 is the fixture that exercises this.
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
