import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { BADGE_ARTWORK_BUCKET } from "@/lib/badge-artwork";
import { measureBadgeArtwork, type BadgeMeasurement } from "@/lib/badge-measure";
import { BatchStatusControls } from "../BatchStatusControls";
import { VoidBadgeButton } from "../VoidBadgeButton";

/**
 * Batch detail — the pre-print contact sheet (spec §5.2).
 *
 * WHY THIS PAGE EXISTS
 *
 * Three consecutive artwork defects reached print review through a green
 * test suite: tofu glyphs, a silent fallback to the wrong typeface, and
 * truncated MXE IDs. Every one was instantly obvious to a human eye and
 * invisible to the assertions in place at the time. Opening PNGs out of
 * the Storage dashboard one at a time worked for twenty-five and does
 * not work for a hundred. Badge artwork goes onto permanent adhesive, so
 * the last check before it does should be a page, not a chore.
 *
 * The measurement beside each badge is the same rule the artwork tests
 * apply (badge-measure.ts), not a second implementation of it.
 */

const SIGNED_URL_TTL_SECONDS = 60 * 30;

/**
 * Server-side fetch concurrency while measuring. Eight keeps a
 * hundred-badge batch to a few seconds without opening enough sockets to
 * look like a problem to Storage. Measuring itself is cheap — ~14 ms per
 * badge to decode and scan — so this is tuned for the network, not CPU.
 */
const MEASURE_CONCURRENCY = 8;

type BatchRow = {
  id: string;
  label: string;
  minted_count: number;
  copies_per_identity: number;
  qr_version: number;
  minted_at: string;
};

type IdentityRow = {
  id: string;
  mxe_id: string;
  status: string;
  artwork_path: string | null;
  void_reason: string | null;
};

export default async function BadgeBatchDetailPage({
  params,
}: {
  params: Promise<{ batchId: string }>;
}) {
  const admin = await requireAdmin();
  if (!admin) redirect("/dashboard");

  const service = createSupabaseServiceClient();
  if (!service) redirect("/dashboard");

  const { batchId } = await params;

  const { data: batchRow } = await service
    .from("badge_print_batches")
    .select("id, label, minted_count, copies_per_identity, qr_version, minted_at")
    .eq("id", batchId)
    .maybeSingle();

  if (!batchRow) notFound();
  const batch = batchRow as BatchRow;

  // Counts only — deliberately a separate, cheap query from the contact
  // sheet's, so the status controls are not behind the measurement pass.
  const { data: statusRows } = await service
    .from("badge_identities")
    .select("status, artwork_path")
    .eq("print_batch_id", batch.id);

  const statusCounts: Record<string, number> = {};
  let missingArtwork = 0;
  for (const row of (statusRows ?? []) as { status: string; artwork_path: string | null }[]) {
    statusCounts[row.status] = (statusCounts[row.status] ?? 0) + 1;
    // Voided identities are excluded here for the same reason the
    // database excludes them from the gate: a deliberately dead badge
    // must not hold the rest of the batch on the bench, and a batch
    // abandoned mid-render is voided exactly as it stands.
    if (row.artwork_path === null && row.status !== "void") missingArtwork += 1;
  }

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-6xl">
        <AdminNav current="/admin/badges" />

        <header className="mb-6">
          <Link
            href="/admin/badges"
            className="font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--text3)] underline-offset-4 hover:underline"
          >
            ← Badge inventory
          </Link>
          <h1 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            {batch.label}
          </h1>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            {batch.minted_count} identities · {batch.copies_per_identity}× each · QR v{batch.qr_version} ·{" "}
            {new Date(batch.minted_at).toLocaleString()}
          </p>
          <p className="mt-3 max-w-2xl font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            Every badge in the batch, read back from Storage. The figure under each is the width of
            the ink actually drawn against the width the outline intended — <strong>1.00 is
            correct</strong>. Anything else is flagged. This is the check before artwork goes on
            permanent adhesive.
          </p>
        </header>

        {/* Status controls render immediately — they need counts, not
            measurements, and an admin who came here to advance a batch
            should not wait on a hundred Storage reads to do it. */}
        <div className="mb-6">
          <BatchStatusControls
            batchId={batch.id}
            counts={statusCounts}
            missingArtwork={missingArtwork}
          />
        </div>

        {/* The sheet streams in on its own. Signing is fast, but reading a
            hundred PNGs back out of Storage to measure them is not, and
            an admin should see the page rather than a spinner tab while
            that happens. */}
        <Suspense fallback={<SheetSkeleton count={batch.minted_count} />}>
          <ContactSheet batchId={batch.id} />
        </Suspense>
      </main>
    </div>
  );
}

function SheetSkeleton({ count }: { count: number }) {
  return (
    <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
      <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
        Reading and measuring {count} badges from Storage…
      </p>
    </div>
  );
}

async function ContactSheet({ batchId }: { batchId: string }) {
  const service = createSupabaseServiceClient();
  if (!service) return null;

  const { data: identityRows, error } = await service
    .from("badge_identities")
    .select("id, mxe_id, status, artwork_path, void_reason")
    .eq("print_batch_id", batchId)
    .order("mxe_id", { ascending: true });

  if (error) {
    return (
      <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
          Couldn&apos;t load identities: {error.message}
        </p>
      </div>
    );
  }

  const identities = (identityRows ?? []) as IdentityRow[];
  const rendered = identities.filter((i) => i.artwork_path !== null);

  // One round trip for the whole batch rather than a hundred. The bucket
  // stays private with no policies; these URLs are the only way the
  // browser sees the artwork, and they expire.
  const paths = rendered.map((i) => i.artwork_path!);
  const signedUrlByPath = new Map<string, string>();
  if (paths.length > 0) {
    const { data: signed } = await service.storage
      .from(BADGE_ARTWORK_BUCKET)
      .createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
    for (const entry of signed ?? []) {
      if (entry.path && entry.signedUrl) signedUrlByPath.set(entry.path, entry.signedUrl);
    }
  }

  // Measured from the same signed URLs the browser will use, so a URL
  // that does not work fails here too rather than silently rendering as
  // a broken tile with a healthy-looking number beside it.
  const measurements = new Map<string, BadgeMeasurement>();
  const queue = [...rendered];
  await Promise.all(
    Array.from({ length: MEASURE_CONCURRENCY }, async () => {
      for (;;) {
        const identity = queue.shift();
        if (!identity) return;
        const url = signedUrlByPath.get(identity.artwork_path!);
        if (!url) {
          measurements.set(identity.id, { ok: false, error: "no signed URL" });
          continue;
        }
        try {
          const response = await fetch(url);
          if (!response.ok) {
            measurements.set(identity.id, { ok: false, error: `HTTP ${response.status}` });
            continue;
          }
          const png = Buffer.from(await response.arrayBuffer());
          measurements.set(identity.id, await measureBadgeArtwork(png, identity.mxe_id));
        } catch (err) {
          measurements.set(identity.id, {
            ok: false,
            error: err instanceof Error ? err.message : "fetch failed",
          });
        }
      }
    }),
  );

  const missing = identities.length - rendered.length;
  const flagged = rendered.filter((i) => {
    if (i.status === "void") return false;
    const m = measurements.get(i.id);
    return !m || !m.ok || !m.worst.ok;
  }).length;

  return (
    <section>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pill tone={flagged > 0 ? "red" : "green"}>
          {flagged} flagged
        </Pill>
        <Pill tone={missing > 0 ? "amber" : "neutral"}>{missing} not rendered</Pill>
        <Pill tone="neutral">{rendered.length - flagged} clean</Pill>
        <span className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
          Links expire in 30 minutes — reload the page to renew them.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {identities.map((identity) => (
          <BadgeTile
            key={identity.id}
            identity={identity}
            batchId={batchId}
            signedUrl={identity.artwork_path ? signedUrlByPath.get(identity.artwork_path) : undefined}
            measurement={measurements.get(identity.id)}
          />
        ))}
      </div>
    </section>
  );
}

function BadgeTile({
  identity,
  batchId,
  signedUrl,
  measurement,
}: {
  identity: IdentityRow;
  batchId: string;
  signedUrl?: string;
  measurement?: BadgeMeasurement;
}) {
  // A voided identity is shown, not hidden. Its MXE ID is burned
  // permanently (§6 row 5) and the sheet is the record of where the
  // batch's numbers went — an absence would just look like a gap someone
  // has to go and explain. It is dimmed rather than flagged red: it is a
  // deliberate decision, not a defect, and it is excluded from the
  // flagged count for the same reason.
  const isVoid = identity.status === "void";

  // An identity with no artwork is a gap in the sheet, not an absence
  // from it. A badge that was never rendered and a badge that rendered
  // wrong are both things the review has to notice.
  if (!identity.artwork_path) {
    return (
      <figure className="rounded-xl border border-dashed border-[var(--amber-fg)] bg-[var(--amber-bg)] p-2">
        <div className="flex aspect-square items-center justify-center rounded-lg">
          <span className="font-[family-name:var(--font-dm)] text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--amber-fg)]">
            Not rendered
          </span>
        </div>
        <figcaption className="mt-1.5 text-center">
          <p className="font-[family-name:var(--font-dm)] text-[11px] font-semibold text-[var(--navy)]">
            {identity.mxe_id}
          </p>
          <p className="font-[family-name:var(--font-dm)] text-[10px] text-[var(--amber-fg)]">
            {isVoid ? `void · ${identity.void_reason ?? "no reason"}` : "no artwork"}
          </p>
          {isVoid ? null : (
            <VoidBadgeButton identityId={identity.id} mxeId={identity.mxe_id} batchId={batchId} />
          )}
        </figcaption>
      </figure>
    );
  }

  const failed = !isVoid && (!measurement || !measurement.ok || !measurement.worst.ok);
  const ratioLabel = !measurement
    ? "unmeasured"
    : measurement.ok
      ? `${measurement.worst.ratio.toFixed(3)}${measurement.worst.ok ? "" : ` · ${measurement.worst.key}`}`
      : measurement.error;

  return (
    <figure
      className={`rounded-xl border p-2 ${
        isVoid
          ? "border-dashed border-[var(--divider)] bg-[var(--cream)] opacity-60"
          : failed
            ? "border-2 border-[var(--red-fg)] bg-[var(--red-bg)]"
            : "border-[var(--divider)] bg-[var(--white)]"
      }`}
    >
      {signedUrl ? (
        <a href={signedUrl} target="_blank" rel="noopener noreferrer" className="block">
          {/* Lazy-loaded at full resolution rather than thumbnailed.
              Supabase image transformation is a paid feature and is NOT
              enabled on this project — a signed URL requesting a
              transform silently returns the full-size original, so
              "thumbnails" would have been 6.6 MB of full-size PNGs
              wearing a smaller width attribute. Lazy loading means only
              the rows actually scrolled to are ever fetched, and the
              full-resolution file is what you want when a tile looks
              wrong and you click it. */}
          {
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={signedUrl}
              alt={`Badge artwork for ${identity.mxe_id}`}
              width={300}
              height={300}
              loading="lazy"
              decoding="async"
              className="aspect-square w-full rounded-lg bg-[var(--navy)] object-contain"
            />
          }
        </a>
      ) : (
        <div className="flex aspect-square items-center justify-center rounded-lg bg-[var(--red-bg)]">
          <span className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">
            no link
          </span>
        </div>
      )}
      <figcaption className="mt-1.5 text-center">
        <p className="font-[family-name:var(--font-dm)] text-[11px] font-semibold text-[var(--navy)]">
          {identity.mxe_id}
        </p>
        <p
          className={`font-[family-name:var(--font-dm)] text-[10px] ${
            failed ? "font-semibold text-[var(--red-fg)]" : "text-[var(--text3)]"
          }`}
        >
          {isVoid ? `void · ${identity.void_reason ?? "no reason"}` : ratioLabel}
        </p>
        {isVoid ? null : (
          <VoidBadgeButton identityId={identity.id} mxeId={identity.mxe_id} batchId={batchId} />
        )}
      </figcaption>
    </figure>
  );
}

function Pill({
  tone,
  children,
}: {
  tone: "red" | "amber" | "green" | "neutral";
  children: React.ReactNode;
}) {
  const tones = {
    red: "bg-[var(--red-bg)] text-[var(--red-fg)]",
    amber: "bg-[var(--amber-bg)] text-[var(--amber-fg)]",
    green: "bg-[var(--green-bg)] text-[var(--green-fg)]",
    neutral: "bg-[var(--blue-bg)] text-[var(--blue-fg)]",
  } as const;
  return (
    <span
      className={`rounded-lg px-2 py-0.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.06em] ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
