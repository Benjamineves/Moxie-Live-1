import { NextResponse } from "next/server";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { emailsMatch, getOwnerEmailByUserId } from "@/lib/owner-verify";
import { getOwnerBillingSummary } from "@/lib/billing-service";
import { tierAllowsServiceRecords } from "@/lib/service-records";
import { isMissingTable } from "@/lib/service-records-store";

const SIGNED_URL_TTL_SECONDS = 60;

function contentTypeFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

/**
 * A service record's attachment, owner-only, proxied through our origin.
 *
 * Built because the attachment was unreachable: uploads stored a path and
 * a name, and nothing — not even the owner who uploaded it — could open
 * the bytes. ServiceHistory's comment promised "the owner's own page
 * renders its own download control alongside"; this is the half that was
 * missing.
 *
 * Deliberately the same shape as documents/[docType]: same auth, same
 * dormancy suspension, same signed-URL-then-proxy, same no-store. The
 * differences are only where the two genuinely differ:
 *
 *  - TIER. Service records are Full Access, so this refuses Basic
 *    outright rather than running the per-slot document lock. A Basic
 *    account has no way to create one of these, but that is a fact about
 *    the UI, not authorization (CLAUDE.md), so the check lives here.
 *  - NO OFFLINE. The document route exists partly so "save for offline"
 *    can cache bytes; service records are not part of that flow, so this
 *    route is online-only and the service worker has no rule for it.
 *  - AFTER A TRANSFER there is nothing to serve. The buyer's row has
 *    file_path NULL (complete_ownership_transfer detaches it) while
 *    file_was_attached stays true, so this returns 404 and the UI offers
 *    no link at all — the attachment is the seller's to share directly.
 */
export async function GET(request: Request, context: { params: Promise<{ mxeId: string; recordId: string }> }) {
  const { mxeId, recordId } = await context.params;

  const supabase = await requireSupabaseServerClient("app/api/vessels/[mxeId]/service-records/[recordId]/route");
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    return NextResponse.json({ error: "Server misconfigured (missing service role key)." }, { status: 503 });
  }

  const { data: vesselRow } = await service
    .from("vessels")
    .select("id, owner_id, lifecycle_status")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();
  const vessel = vesselRow as { id: string; owner_id: string; lifecycle_status: string | null } | null;
  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
  }

  const ownerEmail = await getOwnerEmailByUserId(vessel.owner_id);
  if (!ownerEmail || !emailsMatch(user.email, ownerEmail)) {
    return NextResponse.json({ error: "Forbidden — sign in as the vessel owner." }, { status: 403 });
  }

  // Same suspension the document route applies (dormant identity spec §3).
  if (vessel.lifecycle_status === "dormant" || vessel.lifecycle_status === "decommissioned") {
    return NextResponse.json({ error: "Document access is suspended for this vessel." }, { status: 403 });
  }

  const billing = await getOwnerBillingSummary(vessel.owner_id);
  if (!tierAllowsServiceRecords(billing.subscriptionTier)) {
    return NextResponse.json({ error: "Service records are part of Full Access." }, { status: 403 });
  }

  // Scoped to the vessel as well as the id, so a record id belonging to
  // another vessel cannot be read through a vessel this user does own.
  const { data: recordRow, error: recordError } = await service
    .from("service_records")
    .select("id, file_path, file_name")
    .eq("id", recordId)
    .eq("vessel_id", vessel.id)
    .maybeSingle();
  if (recordError && !isMissingTable(recordError)) {
    return NextResponse.json({ error: "Could not read that entry." }, { status: 502 });
  }
  const record = (recordRow ?? null) as { id: string; file_path: string | null; file_name: string | null } | null;
  if (!record?.file_path) {
    return NextResponse.json({ error: "No attachment on this entry." }, { status: 404 });
  }

  const { data: signed, error: signError } = await service.storage
    .from("vessel-docs")
    .createSignedUrl(record.file_path, SIGNED_URL_TTL_SECONDS);
  if (signError || !signed?.signedUrl) {
    return NextResponse.json({ error: "Could not generate a download link." }, { status: 502 });
  }

  const fileRes = await fetch(signed.signedUrl);
  if (!fileRes.ok || !fileRes.body) {
    return NextResponse.json({ error: "Could not read the stored file." }, { status: 502 });
  }

  return new NextResponse(fileRes.body, {
    status: 200,
    headers: {
      "Content-Type": contentTypeFor(record.file_path),
      "Cache-Control": "no-store",
    },
  });
}
