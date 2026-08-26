import Link from "next/link";
import { redirect } from "next/navigation";
import { PixelM } from "@/components/PixelM";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { VesselRecord } from "@/types/vessel";

async function signOutAction() {
  "use server";

  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  redirect("/login");
}

export default async function DashboardPage() {
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

  const { data: vessels, error } = await service
    .from("vessels")
    .select("*")
    .in("owner_id", ownerIds)
    .order("created_at", { ascending: false });

  const ownedVessels = ((vessels ?? []) as VesselRecord[]).filter((v) => v.mxe_id);

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

        {!error && ownedVessels.length === 0 ? (
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

        {ownedVessels.length > 0 ? (
          <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {ownedVessels.map((vessel) => (
              <article
                key={vessel.id}
                className="overflow-hidden rounded-2xl border border-[var(--divider)] bg-[var(--white)] shadow-sm"
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
                  <p className="inline-flex rounded-full bg-[var(--gold-dim)] px-2.5 py-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--navy)]">
                    {vessel.mxe_id}
                  </p>
                  <h3 className="mt-3 font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
                    {vessel.vessel_name}
                  </h3>
                  <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                    {vessel.make} {vessel.model} · {vessel.year}
                  </p>
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
                </div>
              </article>
            ))}
          </section>
        ) : null}
      </main>
    </div>
  );
}
