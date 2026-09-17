import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { loadOwnedVessel, resolveOwnerIds } from "@/lib/vessel-ownership";
import { loadServiceRecords } from "@/lib/service-records-store";
import { tierAllowsServiceRecords } from "@/lib/service-records";
import { AttachmentPolicyNote, ServiceHistory } from "@/components/service/ServiceHistory";
import { ServiceRecordEditor } from "./ServiceRecordEditor";
import { ServiceAttachment } from "./ServiceAttachment";

export const metadata: Metadata = { title: "Service history · Moxie" };

type Props = { params: Promise<{ mxeId: string }> };

/**
 * The owner's service history. Full Access only.
 *
 * Separate from /documents on purpose: the four primary documents are
 * identity papers with renewal dates, and this is a log of work done. They
 * answer different questions and mixing them would make both worse.
 */
export default async function ServiceHistoryPage({ params }: Props) {
  const { mxeId } = await params;
  const next = `/dashboard/${encodeURIComponent(mxeId)}/service`;

  const authClient = await requireSupabaseServerClient("app/dashboard/[mxeId]/service/page");
  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) redirect(`/login?next=${next}`);

  const service = requireSupabaseServiceClient("app/dashboard/[mxeId]/service/page");
  const owned = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!owned) redirect("/dashboard");

  const { data: ownerRow } = await service
    .from("users")
    .select("subscription_tier")
    .eq("id", owned.owner_id)
    .maybeSingle();
  const tier = (ownerRow as { subscription_tier: string | null } | null)?.subscription_tier ?? "basic";
  const allowed = tierAllowsServiceRecords(tier);

  // Tolerates the table not existing yet: migrations run after the deploy,
  // and an owner should see an empty history in that window, not a 500.
  const records = allowed ? await loadServiceRecords(service, owned.id) : [];

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-3xl">
        <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
          {mxeId.toUpperCase()}
        </p>
        <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
          Service history
        </h1>
        <p className="mt-2 max-w-xl font-[family-name:var(--font-dm)] text-sm font-light leading-relaxed text-[var(--text2)]">
          What&rsquo;s been done to the boat, and when. Entries stay with the vessel when you sell it.
        </p>

        {!allowed ? (
          <div className="mt-8 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-dim)] px-5 py-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Service history is part of Full Access.{" "}
              <Link className="text-[var(--gold-deep)] underline underline-offset-2" href="/dashboard/upgrade">
                See what that includes
              </Link>
              . Your registration, insurance, boater card and fishing licence are unaffected.
            </p>
          </div>
        ) : (
          <>
            <div className="mt-8">
              <ServiceRecordEditor mxeId={mxeId.toUpperCase()} records={records} />
            </div>
            <div className="mt-10">
              {/*
                The owner's own view, and the only place a file path goes
                anywhere near the UI. ServiceHistory still takes no path —
                it calls this back per entry, and it is this component that
                knows how to open one. The shared and post-transfer views
                pass no children and so render exactly as before.
              */}
              <ServiceHistory records={records} now={new Date()}>
                {(record) => <ServiceAttachment mxeId={mxeId.toUpperCase()} record={record} />}
              </ServiceHistory>
            </div>
            {/*
              A buyer's view of a history they inherited. Entries whose file
              was detached at transfer are the seller's to share, so the note
              explains that rather than leaving the new owner hunting for a
              download link that was never theirs.
            */}
            {records.some((r) => r.file_was_attached && !r.file_path) ? <AttachmentPolicyNote /> : null}
          </>
        )}

        <p className="mt-10 font-[family-name:var(--font-dm)] text-sm">
          <Link className="text-[var(--blue-fg)] underline" href={`/dashboard/${encodeURIComponent(mxeId.toUpperCase())}/documents`}>
            Back to documents
          </Link>
        </p>
      </main>
    </div>
  );
}
