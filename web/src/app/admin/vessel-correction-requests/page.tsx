import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin-verify";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { AdminNav } from "@/components/AdminNav";
import { ApproveApplyButton } from "./ApproveApplyButton";

type RequestRow = {
  id: string;
  mxe_id: string;
  field_name: string;
  current_value: string | null;
  requested_value: string;
  document_path: string;
  notes: string | null;
  status: string;
  created_at: string;
};

const FIELD_LABELS: Record<string, string> = {
  hin: "HIN",
  make: "Make",
  model: "Model",
  year: "Year",
  length_ft: "Length (ft)",
  draft_ft: "Draft (ft)",
  engine: "Engine",
};

const SIGNED_URL_TTL_SECONDS = 60 * 10;

type Props = {
  searchParams: Promise<{ resolved?: string }>;
};

/**
 * Admin-visible queue for owner-submitted locked-field correction
 * requests (see owner-actions.ts's submitIdentityCorrectionRequest and
 * migration 20260831_vessel_identity_correction_requests.sql).
 * Deliberately minimal — reviewing a request means opening the attached
 * document, deciding, then "Approve & apply," which atomically writes the
 * value to the vessel and resolves the request in one step (see
 * ApproveApplyButton / actions.ts) — the identity audit trigger fires as
 * part of that same write.
 */
export default async function VesselCorrectionRequestsPage({ searchParams }: Props) {
  const admin = await requireAdmin();
  if (!admin) {
    redirect("/dashboard");
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const sp = await searchParams;
  const showingResolved = sp.resolved === "1";

  const { data: rows, error } = await service
    .from("vessel_identity_correction_requests")
    .select("id, mxe_id, field_name, current_value, requested_value, document_path, notes, status, created_at")
    .eq("status", showingResolved ? "resolved" : "pending")
    .order("created_at", { ascending: showingResolved ? false : true });

  const requests = (rows ?? []) as RequestRow[];

  const withSignedUrls = await Promise.all(
    requests.map(async (r) => {
      const { data } = await service.storage.from("vessel-docs").createSignedUrl(r.document_path, SIGNED_URL_TTL_SECONDS);
      return { ...r, signedUrl: data?.signedUrl ?? null };
    }),
  );

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-5xl">
        <AdminNav current="/admin/vessel-correction-requests" />
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
              Admin
            </p>
            <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
              Vessel correction requests
            </h1>
            <p className="mt-2 max-w-2xl font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              Owner requests to correct a locked field (HIN, make, model, year, length, draft, engine), each with a
              required supporting document. Review the document, then Approve &amp; apply to write the value and
              resolve the request in one step — nothing is applied automatically.
            </p>
          </div>
          <Link
            href={showingResolved ? "/admin/vessel-correction-requests" : "/admin/vessel-correction-requests?resolved=1"}
            className="font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
          >
            {showingResolved ? "Show pending" : "Show resolved"}
          </Link>
        </header>

        {error ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-4">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">
              Couldn&apos;t load requests: {error.message}
            </p>
          </div>
        ) : withSignedUrls.length === 0 ? (
          <div className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-6 text-center">
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              {showingResolved ? "No resolved requests." : "No pending requests."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {withSignedUrls.map((r) => (
              <div key={r.id} className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
                      {r.mxe_id} · {FIELD_LABELS[r.field_name] ?? r.field_name}
                    </p>
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
                      <span className="text-[var(--text3)] line-through">{r.current_value || "—"}</span>
                      {" → "}
                      <span className="font-medium text-[var(--navy)]">{r.requested_value}</span>
                    </p>
                    {r.notes ? (
                      <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
                        &ldquo;{r.notes}&rdquo;
                      </p>
                    ) : null}
                    <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
                      Submitted {new Date(r.created_at).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    {r.signedUrl ? (
                      <a
                        href={r.signedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-md border border-[var(--divider)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text)]"
                      >
                        View document
                      </a>
                    ) : (
                      <span className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">
                        Document unavailable
                      </span>
                    )}
                    {!showingResolved ? (
                      <ApproveApplyButton
                        requestId={r.id}
                        mxeId={r.mxe_id}
                        fieldLabel={FIELD_LABELS[r.field_name] ?? r.field_name}
                        currentValue={r.current_value ?? ""}
                        requestedValue={r.requested_value}
                      />
                    ) : null}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
