import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { AccountBillingPanel } from "@/components/AccountBillingPanel";
import { SignOutButton } from "@/components/SignOutButton";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseServiceClient } from "@/lib/supabase/service";
import { resolveOwnerIds, loadOwnedVessel } from "@/lib/vessel-ownership";
import { getOwnerBillingSummary } from "@/lib/billing-service";
import { loadVesselDocumentMeta } from "@/lib/document-metadata";
import { VesselDocuments, type DocumentsVessel } from "./VesselDocuments";

type Props = { params: Promise<{ mxeId: string }> };

const VESSEL_COLUMNS = [
  "mxe_id",
  "vessel_name",
  "make",
  "model",
  "year",
  "hin",
  "reg_state",
  "reg_number",
  "reg_expiry",
  "ins_expiry",
  "owner_name",
  "owner_phone",
  "emg_name",
  "emg_phone",
  "photo_url",
  "doc_registration_url",
  "doc_insurance_url",
  "doc_boater_card_url",
  "doc_registration_filename",
  "doc_insurance_filename",
  "doc_boater_card_filename",
  "ca_boater_card",
  "qr_status",
  "lifecycle_status",
  "dormant_cause",
].join(", ");

export default async function VesselDocumentsPage({ params }: Props) {
  const { mxeId } = await params;
  const next = `/dashboard/${encodeURIComponent(mxeId)}/documents`;

  const authClient = await createSupabaseServerClient();
  if (!authClient) redirect(`/login?next=${next}`);

  const { user, ownerIds } = await resolveOwnerIds(authClient);
  if (!user) redirect(`/login?next=${next}`);

  const service = createSupabaseServiceClient();
  if (!service) redirect("/dashboard");

  const owned = await loadOwnedVessel(service, mxeId, ownerIds);
  if (!owned) redirect("/dashboard");

  const { data: vesselRow } = await service
    .from("vessels")
    .select(VESSEL_COLUMNS)
    .eq("id", owned.id)
    .maybeSingle();
  const vessel = vesselRow as unknown as
    | (DocumentsVessel & {
        doc_registration_filename: string | null;
        doc_insurance_filename: string | null;
        doc_boater_card_filename: string | null;
      })
    | null;
  if (!vessel) redirect("/dashboard");

  // Upload date + size for each stored document, read from Storage (see
  // lib/document-metadata.ts) — resolved here rather than client-side so
  // it costs one listing during this render instead of a round trip
  // after paint. Also feeds the per-document cache token.
  const documentMeta = await loadVesselDocumentMeta(service, vessel);

  const billing = await getOwnerBillingSummary(owned.owner_id);
  const subscriptionTier = billing?.subscriptionTier ?? "basic";

  // singleVessel drives the automatic-caching default (build spec §8
  // decision 2). Counted across every id this owner resolves to, not
  // just vessel.owner_id — the same owner-by-email-mismatch
  // accommodation resolveOwnerIds already makes, or a mismatched account
  // would always read as "single vessel."
  const { count: activeVesselCount } = await service
    .from("vessels")
    .select("id", { count: "exact", head: true })
    .in("owner_id", ownerIds)
    .neq("lifecycle_status", "decommissioned");

  return (
    <div className="min-h-screen bg-[var(--cream)] pb-16">
      <AppHeader role="Owner" wordmarkHref="/dashboard">
        <Link
          href={`/dashboard/${encodeURIComponent(vessel.mxe_id)}/shares`}
          className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)] transition hover:text-[var(--gold)]"
        >
          Shares
        </Link>
        <Link
          href={`/dashboard/${encodeURIComponent(vessel.mxe_id)}/documents`}
          className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)] transition hover:text-[var(--gold)]"
        >
          Documents
        </Link>
        {billing ? <AccountBillingPanel billing={billing} /> : null}
        <SignOutButton />
      </AppHeader>

      <header className="border-b-[3px] border-[var(--gold)] bg-[var(--navy-deep)] px-5 pb-6 pt-7">
        <div className="mx-auto max-w-lg">
          <p className="font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.4)]">
            {vessel.mxe_id}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-3xl font-light text-white">
            Ship&apos;s <em className="text-[var(--gold)] not-italic">Papers</em>
          </h1>
          <p className="mt-2 font-[family-name:var(--font-dm)] text-xs text-[rgba(255,255,255,.55)]">
            {vessel.vessel_name}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-lg px-5">
        <Link
          href={`/${encodeURIComponent(vessel.mxe_id)}?role=owner`}
          className="mt-4 block w-full bg-[var(--navy)] py-3.5 text-center font-[family-name:var(--font-dm)] text-xs font-bold uppercase tracking-[0.14em] text-[var(--gold)] transition hover:bg-[var(--navy2)]"
        >
          Back to vessel profile
        </Link>

        <VesselDocuments
          vessel={vessel}
          subscriptionTier={subscriptionTier}
          documentMeta={documentMeta}
          singleVessel={(activeVesselCount ?? 0) <= 1}
        />
      </main>
    </div>
  );
}
