import type { SupabaseClient } from "@supabase/supabase-js";
import type { PermissiveDatabase } from "./supabase/schema-stub.ts";
import type { ServiceRecord } from "./service-records.ts";

type ServiceClient = SupabaseClient<PermissiveDatabase>;

/**
 * Reads and writes for service_records, kept apart from the display rules
 * in service-records.ts so those stay testable without a database.
 *
 * TOLERATES A MISSING TABLE. Migrations are run by hand after the deploy
 * (CLAUDE.md), so between the two this table does not exist. A missing
 * table reads as an empty history rather than throwing, which shows an
 * owner "no records yet" instead of a 500 on their documents page. Writes
 * do not pretend: they return a plain sentence saying the feature is not
 * live yet.
 */

/** PostgREST and Postgres both have a way of saying "no such table". */
export function isMissingTable(error: { code?: string } | null | undefined): boolean {
  return error?.code === "PGRST205" || error?.code === "42P01";
}

const COLUMNS =
  "id, vessel_id, logged_by, service_date, category, description, provider, file_path, file_name, file_size_bytes, file_was_attached, logged_at, updated_at";

export async function loadServiceRecords(service: ServiceClient, vesselId: string): Promise<ServiceRecord[]> {
  const { data, error } = await service
    .from("service_records")
    .select(COLUMNS)
    .eq("vessel_id", vesselId)
    .order("service_date", { ascending: false })
    .order("logged_at", { ascending: false });

  if (error) {
    if (isMissingTable(error)) return [];
    throw new Error(`Failed to load service records: ${error.message}`);
  }
  return (data ?? []) as unknown as ServiceRecord[];
}

/**
 * The same history as a buyer or a share-link viewer sees it: no file
 * paths, ever. `file_was_attached` survives, which is the whole point —
 * "14 of 22 entries have documents" without handing over the documents.
 *
 * Stripped here rather than filtered in the view, so no component can
 * accidentally render a path it was handed.
 */
export function withoutFilePaths(records: ServiceRecord[]): ServiceRecord[] {
  return records.map((r) => ({ ...r, file_path: null, file_name: null, file_size_bytes: null }));
}

export type InsertServiceRecord = {
  vesselId: string;
  loggedBy: string;
  serviceDate: string;
  category: string;
  description: string;
  provider: string | null;
  file: { path: string; name: string; sizeBytes: number | null } | null;
};

export async function insertServiceRecord(
  service: ServiceClient,
  input: InsertServiceRecord,
): Promise<{ id: string } | { error: string }> {
  const { data, error } = await service
    .from("service_records")
    .insert({
      vessel_id: input.vesselId,
      logged_by: input.loggedBy,
      service_date: input.serviceDate,
      category: input.category,
      description: input.description,
      provider: input.provider,
      file_path: input.file?.path ?? null,
      file_name: input.file?.name ?? null,
      file_size_bytes: input.file?.sizeBytes ?? null,
      file_was_attached: !!input.file,
      // logged_at is deliberately absent: the database sets it and a
      // trigger refuses to let it move afterwards. Sending one here would
      // be ignored, which is the point.
    })
    .select("id")
    .single();

  if (error) {
    if (isMissingTable(error)) return { error: "Service records aren't live yet. Try again shortly." };
    return { error: `Could not save that entry: ${error.message}` };
  }
  return { id: (data as { id: string }).id };
}

export type UpdateServiceRecord = {
  serviceDate: string;
  category: string;
  description: string;
  provider: string | null;
};

/**
 * Edits the owner-entered fields. logged_at is never in this payload, and
 * the trigger would restore it even if it were.
 */
export async function updateServiceRecord(
  service: ServiceClient,
  id: string,
  vesselId: string,
  input: UpdateServiceRecord,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await service
    .from("service_records")
    .update({
      service_date: input.serviceDate,
      category: input.category,
      description: input.description,
      provider: input.provider,
    })
    .eq("id", id)
    .eq("vessel_id", vesselId);

  if (error) {
    if (isMissingTable(error)) return { error: "Service records aren't live yet." };
    return { error: `Could not update that entry: ${error.message}` };
  }
  return { ok: true };
}

export async function loadServiceRecord(
  service: ServiceClient,
  id: string,
  vesselId: string,
): Promise<ServiceRecord | null> {
  const { data, error } = await service
    .from("service_records")
    .select(COLUMNS)
    .eq("id", id)
    .eq("vessel_id", vesselId)
    .maybeSingle();
  if (error) {
    if (isMissingTable(error)) return null;
    throw new Error(`Failed to load service record: ${error.message}`);
  }
  return (data ?? null) as unknown as ServiceRecord | null;
}

export async function deleteServiceRecord(
  service: ServiceClient,
  id: string,
  vesselId: string,
): Promise<{ ok: true } | { error: string }> {
  const { error } = await service.from("service_records").delete().eq("id", id).eq("vessel_id", vesselId);
  if (error) {
    if (isMissingTable(error)) return { error: "Service records aren't live yet." };
    return { error: `Could not delete that entry: ${error.message}` };
  }
  return { ok: true };
}
