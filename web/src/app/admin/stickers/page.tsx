import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { StickerQueueTable, type StickerRow } from "./StickerQueueTable";

type Props = {
  searchParams: Promise<{ shipped?: string }>;
};

/**
 * Sticker fulfillment queue (build spec §6). Deliberate exception to the
 * role-filtered rendering architecture (filterVesselForRole /
 * lib/vessel-service.ts): this is the one place in the app that
 * intentionally returns owner name/email across every customer at once,
 * because that's the whole point of a fulfillment queue. Gated on
 * requireAdmin() rather than the owner/public role system — see
 * lib/admin-verify.ts for why that check is email-allowlist-backed rather
 * than relying on role='admin' alone.
 */
export default async function StickerFulfillmentPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const showingShipped = sp.shipped === "1";

  let query = service
    .from("vessels")
    .select("mxe_id, vessel_name, owner_name, owner_email, qr_generated_at, sticker_order_status")
    .eq("qr_status", "active");

  // Default view excludes shipped vessels — that's the steady-state "queue."
  // ?shipped=1 lifts the filter so an already-shipped, already-hidden
  // vessel can still be found and reverted later, from any session.
  if (!showingShipped) {
    query = query.neq("sticker_order_status", "shipped");
  }

  const { data: rows, error } = await query.order("qr_generated_at", { ascending: true });

  const vessels = (rows ?? []) as StickerRow[];

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/stickers" />
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Admin
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              Sticker fulfillment
            </h1>
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              {showingShipped
                ? "All active vessels, including shipped."
                : "Active vessels waiting on a sticker, oldest first."}
            </p>
          </div>
          <Link
            href={showingShipped ? "/admin/stickers" : "/admin/stickers?shipped=1"}
            className="font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
          >
            {showingShipped ? "Hide shipped vessels" : "Show shipped vessels"}
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t load the queue: {error.message}
            </p>
          </div>
        ) : (
          <StickerQueueTable initialVessels={vessels} />
        )}
      </main>
    </div>
  );
}
