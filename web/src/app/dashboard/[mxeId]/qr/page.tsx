import Link from "next/link";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
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
    .select("mxe_id, vessel_name, owner_id")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  if (!vessel || !ownerIds.includes(vessel.owner_id)) {
    redirect("/dashboard");
  }

  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://moxieyacht.com";
  const targetUrl = `${baseUrl.replace(/\/$/, "")}/${encodeURIComponent(vessel.mxe_id)}`;
  const svg = await QRCode.toString(targetUrl, { type: "svg", margin: 1, width: 320 });

  if (printOnly) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-[420px] flex-col items-center justify-center bg-[var(--white)] p-6">
        <p className="font-[family-name:var(--font-display)] text-4xl font-light italic text-[var(--gold)]">
          {vessel.mxe_id}
        </p>
        <div className="mt-4 w-full max-w-[300px]" dangerouslySetInnerHTML={{ __html: svg }} />
        <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          {baseUrl.replace(/^https?:\/\//, "")}/{vessel.mxe_id}
        </p>
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

        <section className="mt-4 rounded-2xl bg-[var(--navy-deep)] p-4">
          <div className="rounded-xl bg-[var(--cream)] p-4">
            <div className="mx-auto w-full max-w-[320px]" dangerouslySetInnerHTML={{ __html: svg }} />
          </div>
          <p className="mt-3 text-center font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--gold)]">
            {vessel.vessel_name}
          </p>
          <p className="mt-1 text-center font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.75)]">
            {baseUrl.replace(/^https?:\/\//, "")}/{vessel.mxe_id}
          </p>
        </section>

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
      </main>
    </div>
  );
}
