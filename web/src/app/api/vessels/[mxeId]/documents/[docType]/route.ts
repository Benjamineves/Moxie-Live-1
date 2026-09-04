import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { emailsMatch, getOwnerEmailByUserId } from "@/lib/owner-verify";
import { isDocumentLocked, type DocumentSlot } from "@/lib/vessel-transfer";
import { getOwnerBillingSummary } from "@/lib/billing-service";

const SIGNED_URL_TTL_SECONDS = 60;

const DOC_TYPES = ["registration", "insurance", "boater_card"] as const;
type DocType = (typeof DOC_TYPES)[number];

function contentTypeFor(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return "application/octet-stream";
}

/**
 * Owner-only document bytes, proxied through our own origin.
 *
 * vessel-docs is a private bucket (see lib/vessel-uploads.ts) — the only
 * existing way to read from it was the admin correction-requests page's
 * one-off createSignedUrl() call. Nothing let an owner fetch their OWN
 * uploaded document at all before this; DocumentsEdit.tsx only ever
 * offers Replace, never View/Download. Built here specifically because
 * "save for offline" (build spec §4) has to fetch the actual bytes to
 * cache them, and a same-origin URL with no expiring signature is what
 * makes that cacheable via the Cache API at all — a raw Supabase signed
 * URL would work once, then go stale as a cache key's underlying auth
 * the moment its signature expired, even though the cached bytes
 * themselves would still be perfectly readable offline.
 */
export async function GET(request: Request, context: { params: Promise<{ mxeId: string; docType: string }> }) {
  const { mxeId, docType } = await context.params;
  if (!DOC_TYPES.includes(docType as DocType)) {
    return NextResponse.json({ error: "Invalid document type" }, { status: 400 });
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return NextResponse.json({ error: "Server misconfigured (missing Supabase env)." }, { status: 503 });
  }

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
    .select("id, owner_id, doc_registration_url, doc_insurance_url, doc_boater_card_url, lifecycle_status, dormant_cause")
    .eq("mxe_id", mxeId.toUpperCase())
    .maybeSingle();

  const vessel = vesselRow as {
    id: string;
    owner_id: string;
    doc_registration_url: string | null;
    doc_insurance_url: string | null;
    doc_boater_card_url: string | null;
    lifecycle_status: string | null;
    dormant_cause: string | null;
  } | null;
  if (!vessel) {
    return NextResponse.json({ error: "Vessel not found" }, { status: 404 });
  }

  const ownerEmail = await getOwnerEmailByUserId(vessel.owner_id);
  if (!ownerEmail || !emailsMatch(user.email, ownerEmail)) {
    return NextResponse.json({ error: "Forbidden — sign in as the vessel owner." }, { status: 403 });
  }

  // Dormant Vessel Identity (docs/moxie_digital_dormant_identity_spec.md
  // §3): document access is suspended while dormant, same as the
  // editing UI's own lock in VesselOwnerProfile.tsx.
  if (vessel.lifecycle_status === "dormant" || vessel.lifecycle_status === "decommissioned") {
    return NextResponse.json({ error: "Document access is suspended for this vessel." }, { status: 403 });
  }

  const paths: Record<DocType, string | null> = {
    registration: vessel.doc_registration_url,
    insurance: vessel.doc_insurance_url,
    boater_card: vessel.doc_boater_card_url,
  };
  const path = paths[docType as DocType];
  if (!path) {
    return NextResponse.json({ error: "No document on file." }, { status: 404 });
  }

  // Same Basic-tier document lock DocumentsEdit.tsx enforces in the UI
  // (registration counted first, insurance second; boater_card always
  // exempt) — offline access must respect the same tier gating as
  // online (build spec §6), not treat a locked document as newly
  // downloadable just because it's being fetched for caching instead of
  // direct view.
  if (docType !== "boater_card") {
    const billing = await getOwnerBillingSummary(vessel.owner_id);
    const subscriptionTier = billing?.subscriptionTier ?? "basic";
    const slots: DocumentSlot[] = [
      { docType: "registration", url: vessel.doc_registration_url },
      { docType: "insurance", url: vessel.doc_insurance_url },
    ];
    const index = slots.findIndex((s) => s.docType === docType);
    if (index >= 0 && isDocumentLocked(slots, index, subscriptionTier)) {
      return NextResponse.json({ error: "This document is locked on your current plan." }, { status: 403 });
    }
  }

  const { data: signed, error: signError } = await service.storage
    .from("vessel-docs")
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
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
      "Content-Type": contentTypeFor(path),
      // Never cache at the HTTP layer with a long TTL — this response is
      // deliberately cached client-side ONLY via the explicit "save for
      // offline" flow (Cache API, opt-in), not implicitly by the browser
      // or any shared/CDN cache. no-store here doesn't fight that: the
      // service worker's own cache-first handling for this route reads
      // from Cache Storage directly, not from the HTTP cache.
      "Cache-Control": "no-store",
    },
  });
}
