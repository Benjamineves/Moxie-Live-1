import Link from "next/link";
import { redirect } from "next/navigation";
import { buildBadgeSvg, assertBadgeQrVersionWithinBudget } from "@/lib/qr-render";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { QrDownload } from "./QrDownload";

type Props = {
  params: Promise<{ mxeId: string }>;
  searchParams: Promise<{ print?: string }>;
};

export default async function VesselQrPage({ params, searchParams }: Props) {
  const { mxeId } = await params;
  const sp = await searchParams;
  const printOnly = sp.print === "1";

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/qr`);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect(`/login?next=/dashboard/${encodeURIComponent(mxeId)}/qr`);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
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

  const { data: vessel } = await service
    .from("vessels")
    .select("mxe_id, vessel_name, owner_id, qr_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    redirect("/dashboard");
  }

  // Payment gate (build spec §5/§14): the QR only exists to unlock once
  // qr_status='active', which only ever happens via the Stripe webhook.
  if (vessel.qr_status !== "active") {
    redirect(`/dashboard/${encodeURIComponent(vessel.mxe_id)}/payment`);
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://moxieyacht.com";
  // ?scan=1 is what routes a real badge scan into ScanSuccess's
  // animation ([mxeId]/page.tsx's scan branch) instead of landing
  // silently on the plain public profile — the printed badge and the
  // ?scan=1 acceptance-test assumption were written to different
  // assumptions before this. One targetUrl feeds both buildBadgeSvg
  // below (on-screen + print view) and QrDownload's PNG render, so
  // there's nothing else to keep in sync.
  const targetUrl = `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(vessel.mxe_id)}?scan=1`;
  // Fails loudly at render time (this page has no static generation —
  // mxeId and NEXT_PUBLIC_BASE_URL are both only known per-request, so
  // there's no build-time point to check this at) rather than silently
  // shipping a denser badge if a future change to either one pushes the
  // encoded URL past version 5. See qr-render.ts for the print-spec math
  // this budget is measured against.
  assertBadgeQrVersionWithinBudget(targetUrl);
  // Full badge (wordmark, QR, divider, caption, Patent Pending) from the
  // single shared layout in lib/badge-layout.ts — see qr-render.ts's
  // buildBadgeSvg. Both this on-screen view and the printOnly view below
  // render the identical composition; only QrDownload.tsx's PNG differs
  // in mechanics (canvas vs. SVG), not in what it shows.
  const badgeSvg = buildBadgeSvg(vessel.mxe_id, targetUrl, { size: 320 });

  if (printOnly) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center bg-[var(--white)] p-6">
        <div className="w-full max-w-[320px]" dangerouslySetInnerHTML={{ __html: badgeSvg }} />
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8">
      <main className="mx-auto w-full max-w-xl rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-6 shadow-sm">
        <div className="flex items-center gap-3">
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[var(--aqua-bright)] text-[var(--navy-deep)]">
            ✓
          </span>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            Your vessel is registered
          </h1>
        </div>

        <p className="mt-5 font-[family-name:var(--font-display)] text-4xl font-light italic text-[var(--gold)]">
          {vessel.mxe_id}
        </p>

        <section className="mt-4 flex justify-center">
          <div className="w-full max-w-[320px]" dangerouslySetInnerHTML={{ __html: badgeSvg }} />
        </section>
        <p className="mt-3 text-center font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
          {vessel.vessel_name}
        </p>

        <p className="mt-5 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          Print this and affix it to your vessel. Anyone with a phone can scan it.
        </p>

        <div className="mt-6 flex flex-wrap gap-3">
          <QrDownload targetUrl={targetUrl} mxeId={vessel.mxe_id} />
          <Link
            href={`/${encodeURIComponent(vessel.mxe_id)}?role=owner`}
            className="rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
          >
            View Your Profile →
          </Link>
          <Link
            href={`/dashboard/${encodeURIComponent(vessel.mxe_id)}/qr?print=1`}
            className="rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
          >
            Printable label
          </Link>
        </div>

        {/* Build spec §8 decision 4: the natural close of the dock-side signup
            flow, right after payment succeeds — not the intake form itself. */}
        <div className="mt-6">
          <InstallPrompt />
        </div>
      </main>
    </div>
  );
}
