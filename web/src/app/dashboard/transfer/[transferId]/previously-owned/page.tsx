import Link from "next/link";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds } from "@/lib/vessel-ownership";

type Props = {
  params: Promise<{ transferId: string }>;
};

type Snapshot = {
  vessel_name?: string;
  make?: string;
  model?: string;
  year?: number;
  vessel_type?: string | null;
  length_ft?: number | string | null;
  draft_ft?: number | string | null;
  hin?: string | null;
  uscg_doc_number?: string | null;
  official_number?: string | null;
  reg_state?: string | null;
  reg_number?: string | null;
  reg_expiry?: string | null;
  photo_url?: string | null;
  public_notes?: string | null;
  storage_type?: string | null;
  storage_city?: string | null;
  storage_state?: string | null;
  marina_name?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  owner_email?: string | null;
  ins_carrier?: string | null;
  ins_policy?: string | null;
  doc_registration_url?: string | null;
  doc_insurance_url?: string | null;
  doc_boater_card_url?: string | null;
};

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0">
      <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
        {label}
      </dt>
      <dd className="text-right font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{value}</dd>
    </div>
  );
}

function DocLink({ label, url }: { label: string; url: string | null | undefined }) {
  if (!url) return null;
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0">
      <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
        {label}
      </dt>
      <dd>
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline"
        >
          View →
        </a>
      </dd>
    </div>
  );
}

/**
 * Read-only, frozen at transfer date — renders entirely from
 * ownership_transfers.vessel_snapshot, never from a live vessels query.
 * The vessel now belongs to the buyer and keeps changing; this page
 * must never reflect that. No edit controls anywhere on this page, by
 * design.
 */
export default async function PreviouslyOwnedPage({ params }: Props) {
  const { transferId } = await params;

  const authClient = await createSupabaseServerClient();
  if (!authClient) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/transfer/${transferId}/previously-owned`)}`);
  }

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(`/dashboard/transfer/${transferId}/previously-owned`)}`);
  }

  const service = createSupabaseServiceClient();
  if (!service) {
    redirect("/dashboard");
  }

  const { data: transferRow } = await service
    .from("ownership_transfers")
    .select("id, mxe_id, seller_id, buyer_email, status, completed_at, vessel_snapshot")
    .eq("id", transferId)
    .maybeSingle();
  const transfer = transferRow as
    | { id: string; mxe_id: string; seller_id: string; buyer_email: string; status: string; completed_at: string | null; vessel_snapshot: Snapshot | null }
    | null;

  if (!transfer || !ownerIds.includes(transfer.seller_id) || transfer.status !== "completed" || !transfer.vessel_snapshot) {
    redirect("/dashboard");
  }

  const s = transfer.vessel_snapshot;

  return (
    <div className="min-h-screen bg-[var(--cream)] px-4 py-8 sm:px-8">
      <main className="mx-auto w-full max-w-lg">
        <Link href="/dashboard" className="font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline">
          ← Back to dashboard
        </Link>

        <div className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--gray-bg)] px-5 py-4 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gray-fg)]">
            Previously owned — frozen at transfer date
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--gray-fg)]">
            Transferred to {transfer.buyer_email}
            {transfer.completed_at ? ` on ${new Date(transfer.completed_at).toLocaleDateString()}` : ""}. Nothing the
            new owner has added since shows here.
          </p>
        </div>

        {s.photo_url?.startsWith("http") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.photo_url} alt={s.vessel_name ?? transfer.mxe_id} className="mt-6 aspect-[16/10] w-full rounded-xl object-cover" />
        ) : null}

        <header className="mt-6 border-b border-[var(--divider)] pb-4">
          <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--text3)]">
            {transfer.mxe_id}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            {s.vessel_name}
          </h1>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {s.make} {s.model} · {s.year}
          </p>
        </header>

        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Length" value={s.length_ft} />
          <Row label="Draft" value={s.draft_ft} />
          <Row label="HIN" value={s.hin} />
          <Row label="USCG doc #" value={s.uscg_doc_number} />
          <Row label="Official number" value={s.official_number} />
          <Row label="Reg. state" value={s.reg_state} />
          <Row label="Reg. number" value={s.reg_number} />
          <Row label="Reg. expiry" value={s.reg_expiry} />
        </dl>

        <h2 className="mt-8 font-[family-name:var(--font-display)] text-xl font-light text-[var(--navy)]">
          Storage (as of transfer)
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Type" value={s.storage_type} />
          <Row label="Marina" value={s.marina_name} />
          <Row label="City" value={s.storage_city} />
          <Row label="State" value={s.storage_state} />
        </dl>

        <h2 className="mt-8 font-[family-name:var(--font-display)] text-xl font-light text-[var(--navy)]">
          Your contact &amp; insurance (as of transfer)
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Owner name" value={s.owner_name} />
          <Row label="Owner phone" value={s.owner_phone} />
          <Row label="Owner email" value={s.owner_email} />
          <Row label="Insurance carrier" value={s.ins_carrier} />
          <Row label="Policy #" value={s.ins_policy} />
        </dl>

        <h2 className="mt-8 font-[family-name:var(--font-display)] text-xl font-light text-[var(--navy)]">
          Your documents
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <DocLink label="Registration (as of transfer)" url={s.doc_registration_url} />
          <DocLink label="Insurance card" url={s.doc_insurance_url} />
          <DocLink label="CA boater card" url={s.doc_boater_card_url} />
        </dl>

        {s.public_notes ? (
          <section className="mt-8 border-l-2 border-[var(--gold-line)] pl-4">
            <h2 className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
              Notes (as of transfer)
            </h2>
            <p className="mt-2 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text)]">
              {s.public_notes}
            </p>
          </section>
        ) : null}
      </main>
    </div>
  );
}
