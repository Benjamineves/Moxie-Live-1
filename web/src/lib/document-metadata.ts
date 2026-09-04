import type { createSupabaseServiceClient } from "@/lib/supabase/service";
import type { DocType } from "@/lib/vessel-uploads";

type ServiceClient = NonNullable<ReturnType<typeof createSupabaseServiceClient>>;

export type DocumentFileMeta = {
  /** Original name as uploaded. Null for anything predating 20260918_document_original_filenames.sql, and for intake-form uploads. */
  fileName: string | null;
  /** ISO timestamp of the stored bytes themselves, straight from Storage. */
  uploadedAt: string | null;
  sizeBytes: number | null;
};

export type VesselDocumentMeta = Partial<Record<DocType, DocumentFileMeta>>;

type DocumentPathFields = {
  doc_registration_url: string | null;
  doc_insurance_url: string | null;
  doc_boater_card_url: string | null;
  doc_registration_filename?: string | null;
  doc_insurance_filename?: string | null;
  doc_boater_card_filename?: string | null;
};

function splitPath(path: string): { folder: string; base: string } {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? { folder: "", base: path } : { folder: path.slice(0, cut), base: path.slice(cut + 1) };
}

function sizeOf(metadata: unknown): number | null {
  if (metadata && typeof metadata === "object" && "size" in metadata) {
    const size = (metadata as { size: unknown }).size;
    if (typeof size === "number" && Number.isFinite(size)) return size;
  }
  return null;
}

/**
 * Real metadata for a vessel's stored documents — upload date and size,
 * read from Storage itself, plus the original filename from the vessel row.
 *
 * Storage is the authoritative source for the first two: because
 * uploadVesselDocument writes to a deterministic path and replaces in
 * place, the object's own updated_at is the timestamp of the bytes
 * currently sitting there, with no schema change or backfill needed to
 * get it. The alternative — a column written at upload time — would
 * only ever be a copy of this that could drift.
 *
 * One list() call per distinct folder, not one per document. Normally
 * that's exactly one call, since all three documents share
 * {userId}/{mxeId}/. It's keyed off the stored paths rather than
 * rebuilt from the current user's id on purpose: after an ownership
 * transfer, documents uploaded by the previous owner keep their
 * original {sellerUserId}/... path while anything the new owner
 * replaces lands under theirs, so a vessel can legitimately straddle
 * two folders and reconstructing the path would silently miss half of
 * them.
 *
 * Degrades quietly: a failed listing yields null date/size rather than
 * an error, because a document row that can't show its size is still a
 * document row the owner needs to be able to open.
 */
export async function loadVesselDocumentMeta(
  service: ServiceClient,
  vessel: DocumentPathFields,
): Promise<VesselDocumentMeta> {
  const paths: Record<DocType, string | null> = {
    registration: vessel.doc_registration_url,
    insurance: vessel.doc_insurance_url,
    boater_card: vessel.doc_boater_card_url,
  };
  const fileNames: Record<DocType, string | null> = {
    registration: vessel.doc_registration_filename ?? null,
    insurance: vessel.doc_insurance_filename ?? null,
    boater_card: vessel.doc_boater_card_filename ?? null,
  };

  const present = (Object.keys(paths) as DocType[]).filter((d) => !!paths[d]);
  if (present.length === 0) return {};

  const folders = new Set(present.map((d) => splitPath(paths[d] as string).folder));
  const listings = new Map<string, Map<string, { updatedAt: string | null; sizeBytes: number | null }>>();

  await Promise.all(
    [...folders].map(async (folder) => {
      const { data, error } = await service.storage.from("vessel-docs").list(folder);
      if (error || !data) return;
      const byName = new Map<string, { updatedAt: string | null; sizeBytes: number | null }>();
      for (const object of data) {
        byName.set(object.name, {
          updatedAt: object.updated_at ?? object.created_at ?? null,
          sizeBytes: sizeOf(object.metadata),
        });
      }
      listings.set(folder, byName);
    }),
  );

  const meta: VesselDocumentMeta = {};
  for (const docType of present) {
    const { folder, base } = splitPath(paths[docType] as string);
    const found = listings.get(folder)?.get(base);
    meta[docType] = {
      fileName: fileNames[docType],
      uploadedAt: found?.updatedAt ?? null,
      sizeBytes: found?.sizeBytes ?? null,
    };
  }
  return meta;
}
