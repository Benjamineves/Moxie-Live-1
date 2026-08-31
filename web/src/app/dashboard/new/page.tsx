import Link from "next/link";
import { redirect } from "next/navigation";
import { PixelM } from "@/components/PixelM";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { VesselIntakeForm } from "./VesselIntakeForm";

export default async function NewVesselPage() {
  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    redirect("/login?next=/dashboard/new");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/login?next=/dashboard/new");
  }

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-4 py-3">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-3">
          <Link href="/dashboard" className="flex items-center gap-2">
            <PixelM size={28} className="shrink-0" />
            <span className="font-[family-name:var(--font-display)] text-xl font-light italic text-white">
              <span className="text-[var(--gold)]">M</span>oxie
            </span>
          </Link>
          <span className="font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.72)]">
            {user.email}
          </span>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
          Register a vessel
        </h1>
        <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
          Complete all four steps to get your MXE ID and print-ready QR code.
        </p>
        <div className="mt-6">
          <VesselIntakeForm />
        </div>
      </main>
    </div>
  );
}
