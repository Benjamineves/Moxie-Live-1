import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { loadMarinaJoinCode, loadMarinaMembership, loadMarinaRoster } from "@/lib/marina-access";
import { MarinaRoster } from "./MarinaRoster";
import { EmptyRoster } from "./EmptyRoster";

export const metadata: Metadata = { title: "Roster · Moxie" };

/**
 * The marina's roster. docs/moxie_digital_marina_access_spec.md §5.3.
 *
 * Staff are users with users.marina_id set (spec §9.2). Everyone on a
 * marina's staff sees the same roster; there are no per-person views.
 *
 * DAY ONE IS THE EMPTY STATE. A marina signs up with zero boats and stays
 * at zero until tenants join, and that is the screen on which a
 * harbormaster decides whether this is worth anything. So it explains how
 * boats arrive, shows the code to give tenants, and says what they'll see
 * once one does — rather than an empty table that looks broken.
 */
export default async function MarinaRosterPage() {
  const authClient = await requireSupabaseServerClient("app/marina/page");
  const {
    data: { user },
  } = await authClient.auth.getUser();
  if (!user?.email) redirect("/login?next=/marina");

  const service = requireSupabaseServiceClient("app/marina/page");
  const membership = await loadMarinaMembership(service, user.email);

  if (!membership) {
    return (
      <div className="min-h-screen bg-[var(--cream)]">
        <AppHeader role="Marina" wordmarkHref="/dashboard" />
        <main className="mx-auto max-w-md px-4 py-10">
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">No marina on this account</h1>
          <p className="mt-3 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {user.email} isn&apos;t attached to a marina. If you work at a marina that uses Moxie, email{" "}
            <a href="mailto:hello@moxieyachting.com" className="text-[var(--gold-deep)] underline underline-offset-2">
              hello@moxieyachting.com
            </a>{" "}
            from this address and we&apos;ll add you.
          </p>
        </main>
      </div>
    );
  }

  const rows = await loadMarinaRoster(service, membership);

  return (
    <div className="min-h-screen bg-[var(--cream)] pb-16">
      <AppHeader role="Marina" wordmarkHref="/marina" />
      <main className="mx-auto max-w-lg px-4 pt-5">
        <header>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">{membership.name}</h1>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {rows.length === 0 ? "No boats shared yet" : `${rows.length} boat${rows.length === 1 ? "" : "s"} shared with you`}
          </p>
        </header>

        {rows.length === 0 ? <EmptyRoster marinaName={membership.name} code={await loadMarinaJoinCode(service, membership.marinaId)} /> : <MarinaRoster rows={rows} />}
      </main>
    </div>
  );
}
