import { notFound, redirect } from "next/navigation";
import { looksLikeMxeId } from "@/lib/mxe-id";

/**
 * `/dashboard/<mxeId>` — the obvious URL for a vessel you own, which until
 * now was not a route at all.
 *
 * `dashboard/[mxeId]` held only sub-pages (documents, payment, qr, shares)
 * and no page of its own, so the bare path 404'd for a vessel the owner
 * holds. The transfer email's "Open your vessel" CTA pointed here and died
 * for every buyer who clicked it (see the note on `vessel_transferred` in
 * lib/email/notification.ts), and because the app-wide 404 then claimed the
 * vessel code did not exist, it read as a failed lookup rather than a
 * missing route.
 *
 * The owner view lives at the root path, which is what every in-app link
 * already uses: `/<mxeId>?role=owner`. This redirects there rather than
 * rendering a second owner view — that page holds the payment gate, the
 * dormancy reconcile and the owner-match check, in an order that has
 * already been a source of drift. One owner view, reached two ways.
 *
 * No auth check here on purpose: `?role=owner` is not a grant. The target
 * requires a positive owner match and falls back to the public view, or to
 * `/login?next=…` for a signed-out visitor. A check here would be a second
 * opinion about who owns what, which is the pattern CLAUDE.md warns off.
 *
 * 307, not 308: the same reasoning as `/s/<token>` (spec §1.7) — a
 * permanent redirect is cached by browsers and intermediaries
 * indefinitely, and this mapping has to stay correctable.
 */
export default async function DashboardVesselPage({ params }: { params: Promise<{ mxeId: string }> }) {
  const { mxeId } = await params;

  // A path that is not MXE-shaped is a bad URL, not a vessel: 404 here
  // rather than bouncing it to the root and 404ing there a hop later.
  if (!looksLikeMxeId(mxeId)) {
    notFound();
  }

  redirect(`/${encodeURIComponent(mxeId.trim().toUpperCase())}?role=owner`);
}
