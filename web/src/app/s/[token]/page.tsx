import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { MARKETING_ORIGIN } from "@/lib/site-domains";
import { normalizeBadgeToken } from "@/lib/badge-token";
import { resolveBadgeScan } from "@/lib/badge-scan";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

/**
 * `/s/<token>` — what every printed badge's QR actually points at
 * (spec §1.4, §1.7).
 *
 * WHY THIS REDIRECTS RATHER THAN RENDERING THE SCAN ITSELF
 *
 * The scan branch in [mxeId]/page.tsx is not a component render. It sits
 * after the payment gate and the dormant-dispatch reconcile, and it
 * performs its own auth lookup to decide destinationRole (owner vs
 * public) and exitHref. Reproducing any of that here would be a second
 * implementation of an ordering-sensitive branch — the exact drift this
 * codebase has been bitten by three times now. Redirecting inherits all
 * of it and leaves one scan implementation.
 *
 * The `?scan=1` the badge no longer carries is added back here. Dropping
 * it from the QR is what buys version 4 density; re-adding it after the
 * scan, server-side, costs nothing physical.
 *
 * A SERVICE CLIENT ON A PUBLIC ROUTE
 *
 * badge_identities is RLS-enabled with no policies precisely so
 * inventory cannot be enumerated, which means no anon or authenticated
 * client can read it — this route has to use the service role. What that
 * buys a caller is bounded on purpose: given a syntactically valid
 * token, it learns that token's status and its own MXE ID, both of which
 * are already in the hand of anyone holding the badge. There is no
 * listing, no count, no batch, and no lookup by anything but an exact
 * token. Guessing one means finding a 9-character Crockford Base32
 * string out of 32^9 (~3.5e13).
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  // A badge scan target is not a document anyone should reach from a
  // search engine, and an indexed /s/ URL would put live tokens in a
  // public index.
  robots: { index: false, follow: false },
};

type IdentityRow = {
  status: string;
  mxe_id: string;
  vessels: { mxe_id: string } | null;
};

export default async function BadgeScanPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Normalized rather than trusted: a scanner or a hand-typed URL can
  // deliver lowercase, and the canonical form is uppercase. Anything
  // that is not a well-formed token is indistinguishable from an unknown
  // one, and gets the same 404 — no "malformed token" message that would
  // tell a prober their guess had the wrong shape.
  const normalized = normalizeBadgeToken(token);
  if (!normalized) notFound();

  const service = createSupabaseServiceClient();
  if (!service) notFound();

  const { data } = await service
    .from("badge_identities")
    // The embed is hinted by column because there are FKs in BOTH
    // directions between these tables — badge_identities.vessel_id and
    // vessels.badge_identity_id — and an unqualified `vessels(...)` is
    // rejected as ambiguous. `!vessel_id` names the column rather than
    // the constraint, so a constraint rename cannot break it.
    .select("status, mxe_id, vessels!vessel_id(mxe_id)")
    .eq("token", normalized)
    .maybeSingle();

  const identity = data as unknown as IdentityRow | null;
  const outcome = resolveBadgeScan(
    identity
      ? {
          status: identity.status,
          mxe_id: identity.mxe_id,
          vesselMxeId: identity.vessels?.mxe_id ?? null,
        }
      : null,
  );

  if (outcome.kind === "notFound") notFound();

  if (outcome.kind === "redirect") {
    // redirect() issues a 307 and must NOT be wrapped in a try/catch —
    // it signals by throwing. 307 rather than 301/308 is deliberate
    // (§1.7): a permanent redirect is cached by browsers and
    // intermediaries indefinitely, and this mapping must stay correctable
    // on devices we do not control, for a badge glued to a boat.
    redirect(`/${outcome.mxeId}?scan=1`);
  }

  const mxeId = identity?.mxe_id ?? "";
  return outcome.reason === "void" ? (
    <ScanNotice
      title="This badge is no longer valid"
      body="It was withdrawn and can't be registered. If you bought a vessel that came with this badge, get in touch and we'll sort out a replacement."
      mxeId={mxeId}
    />
  ) : (
    <ScanNotice
      title="This badge hasn't been registered yet"
      body="It's a genuine Moxie badge that hasn't been paired with a vessel. If it came with a boat you've just bought, the previous owner still needs to transfer it — or you can register it yourself."
      mxeId={mxeId}
    />
  );
}

/**
 * Deliberately says nothing about inventory (§1.7): no counts, no batch,
 * no neighbouring IDs. The badge's own MXE ID is shown because it is
 * already printed on the object in the scanner's hand, and quoting it is
 * the first thing support will ask for.
 */
function ScanNotice({
  title,
  body,
  mxeId,
}: {
  title: string;
  body: string;
  mxeId: string;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--navy)] px-5 py-12">
      <main className="w-full max-w-md text-center">
        <p className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--white)]">
          Moxie
        </p>

        <div className="mt-8 rounded-2xl bg-[var(--white)] p-6 shadow-lg">
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-light italic text-[var(--navy)]">
            {title}
          </h1>
          <p className="mt-3 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
            {body}
          </p>

          <p className="mt-5 font-[family-name:var(--font-dm)] text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Badge {mxeId}
          </p>

          <a
            href={MARKETING_ORIGIN}
            className="mt-6 inline-block rounded-xl bg-[var(--navy)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--white)]"
          >
            About Moxie
          </a>
        </div>
      </main>
    </div>
  );
}
