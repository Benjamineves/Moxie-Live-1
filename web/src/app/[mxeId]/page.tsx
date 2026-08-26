import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { ScanSuccess } from "@/components/ScanSuccess";
import { VesselPublicProfile } from "@/components/VesselPublicProfile";
import { VesselOwnerProfile, type OwnerProfileTier } from "@/components/VesselOwnerProfile";
import { fetchVesselByMxeId, filterVesselForRole } from "@/lib/vessel-service";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { emailsMatch, getOwnerEmailByUserId } from "@/lib/owner-verify";

const MXE_RE = /^MXE-\d{5}$/i;

type Props = {
  params: Promise<{ mxeId: string }>;
  searchParams: Promise<{ scan?: string; role?: string }>;
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

    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <VesselOwnerProfile tier={tier} />
      </div>
    );
  }

  const tier = filterVesselForRole(vessel, "public") as {
    mxe_id: string;
    vessel_name: string;
    vessel_type: string | null;
    make: string;
    model: string;
    year: number;
    length_ft: number | string | null;
    draft_ft: number | string | null;
    public_notes: string | null;
    photo_url: string | null;
    marina_name: string | null;
    marina_city: string | null;
  };

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
