import { NextResponse } from "next/server";
import { requireSupabaseServerClient } from "@/lib/supabase/server";
import { requireSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds } from "@/lib/vessel-ownership";
import { decidePreviouslyOwnedDocument, type TransferForDocument } from "@/lib/previously-owned-documents";
import { documentContentType } from "@/lib/document-content-type";

const SIGNED_URL_TTL_SECONDS = 60;

/**
 * A seller's documents as they stood at transfer, from the frozen snapshot
 * (the previously-owned page's "View →" links).
 *
 * vessel-docs is private and, since 20261011, a signed-in user can only
 * touch their own folder directly. A carried-over registration can sit in
 * an earlier owner's folder, so this reads with the service role — who may
 * is decided by decidePreviouslyOwnedDocument (the seller, completed
 * transfers only) — and streams through a 60-second signed URL, never
 * handing the URL itself to the browser.
 */
export async function GET(_request: Request, context: { params: Promise<{ transferId: string; docType: string }> }) {
  const { transferId, docType } = await context.params;

  const authClient = await requireSupabaseServerClient("app/api/transfers/[transferId]/documents/[docType]/route");
  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const service = requireSupabaseServiceClient("app/api/transfers/[transferId]/documents/[docType]/route");
  const { data: transferRow, error: readError } = await service
    .from("ownership_transfers")
    .select("seller_id, status, vessel_snapshot")
    .eq("id", transferId)
    .maybeSingle();
  // A malformed id is Postgres 22P02 — "no such transfer", not a failure.
  if (readError && readError.code !== "22P02") {
    throw new Error(`ownership_transfers read failed: ${readError.message}`);
  }

  const decision = decidePreviouslyOwnedDocument((transferRow as TransferForDocument | null) ?? null, ownerIds, docType);
  if (!decision.ok) {
    return NextResponse.json({ error: decision.error }, { status: decision.status });
  }

  const { data: signed, error: signError } = await service.storage
    .from("vessel-docs")
    .createSignedUrl(decision.path, SIGNED_URL_TTL_SECONDS);
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
      "Content-Type": documentContentType(decision.path),
      // A former owner's personal documents: no browser or CDN caching.
      "Cache-Control": "no-store",
    },
  });
}
