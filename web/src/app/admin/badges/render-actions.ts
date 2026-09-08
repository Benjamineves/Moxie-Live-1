"use server";

import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { BADGE_ARTWORK_BUCKET, badgeArtworkPath, renderBadgeArtworkPng } from "@/lib/badge-artwork";
import { RENDER_CHUNK_SIZE, type RenderChunkResult } from "@/lib/badge-render-chunk";
import { badgeScanUrl } from "@/lib/badge-url";
import { getQrModules } from "@/lib/qr-render";

/**
 * Renders one chunk of a batch's outstanding artwork — spec §5.0.2
 * steps 5-7, the part that deliberately sits OUTSIDE the mint's
 * transaction because a Storage write cannot join a Postgres one.
 *
 * Resumable by construction: it selects only rows where artwork_path IS
 * NULL, so re-running skips everything already done and there is no
 * cursor, no job row and no progress counter to get out of step with
 * reality. A chunk that dies halfway leaves the identities it completed
 * done and the rest exactly as they were. That is why §5.0.3 says a
 * partial render needs no cleanup: the null column IS the work queue.
 *
 * Nothing rendered here becomes pickable. These rows are 'minted', and
 * assignment only ever selects 'in_stock' (§3.1) — an identity cannot
 * reach a customer part-rendered no matter how this fails.
 */
export async function renderBatchArtworkChunk(batchId: string): Promise<RenderChunkResult> {
  const admin = await requireAdmin();
  if (!admin) return { error: "Not authorized." };

  const service = createSupabaseServiceClient();
  if (!service) return { error: "Missing Supabase service role configuration." };

  const { data: rows, error: selectError } = await service
    .from("badge_identities")
    .select("id, mxe_id, token")
    .eq("print_batch_id", batchId)
    .is("artwork_path", null)
    .order("mxe_id", { ascending: true })
    .limit(RENDER_CHUNK_SIZE);

  if (selectError) return { error: `Could not read the batch: ${selectError.message}` };

  const pending = (rows ?? []) as { id: string; mxe_id: string; token: string }[];
  if (pending.length === 0) return { rendered: 0, remaining: 0, done: true };

  let rendered = 0;
  for (const identity of pending) {
    try {
      const png = await renderBadgeArtworkPng(identity.mxe_id, identity.token);
      const path = badgeArtworkPath(batchId, identity.mxe_id);

      // upsert so a resumed or repeated render overwrites cleanly rather
      // than failing on an object left behind by a chunk that uploaded
      // and then died before recording artwork_path.
      const { error: uploadError } = await service.storage
        .from(BADGE_ARTWORK_BUCKET)
        .upload(path, png, { contentType: "image/png", upsert: true });
      if (uploadError) throw new Error(`upload failed: ${uploadError.message}`);

      // artwork_path is written only AFTER the bytes are safely stored.
      // The other order would mark an identity rendered while its file
      // was missing, and the batch could then advance to 'printed' with
      // nothing to print.
      const { error: updateError } = await service
        .from("badge_identities")
        .update({
          artwork_path: path,
          qr_version: getQrModules(badgeScanUrl(identity.token)).version,
        })
        .eq("id", identity.id);
      if (updateError) throw new Error(`could not record artwork_path: ${updateError.message}`);

      rendered += 1;
    } catch (err) {
      // Report what was completed rather than discarding it. The
      // finished identities keep their artwork_path, the failed one
      // stays NULL, and Resume picks up exactly where this stopped.
      return {
        rendered,
        error: `Stopped at ${identity.mxe_id}: ${err instanceof Error ? err.message : "render failed"}. ${rendered} rendered before this; resume to continue.`,
      };
    }
  }

  const { count } = await service
    .from("badge_identities")
    .select("id", { count: "exact", head: true })
    .eq("print_batch_id", batchId)
    .is("artwork_path", null);

  const remaining = count ?? 0;
  return { rendered, remaining, done: remaining === 0 };
}
