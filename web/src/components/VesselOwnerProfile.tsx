import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { VesselPublicProfile, type PublicProfileProps } from "@/components/VesselPublicProfile";
import { SignOutButton } from "@/components/SignOutButton";
import { SaveOfflineControl } from "@/components/pwa/SaveOfflineControl";
import { isDocumentLocked, type DocumentSlot } from "@/lib/vessel-transfer";
import type { OfflineDocType } from "@/lib/offline-vessel-store";
import type { VesselDocumentMeta } from "@/lib/document-metadata";
import { AccountBillingPanel } from "@/components/AccountBillingPanel";
import { AddPhotoNudge } from "@/components/AddPhotoNudge";
import { ExpiryDateNudge } from "@/components/ExpiryDateNudge";
import { ReplacePhotoControl } from "@/components/ReplacePhotoControl";
import { BfcacheRefresh } from "@/components/BfcacheRefresh";
import { VesselDetailsEdit } from "@/components/vessel-edit/VesselDetailsEdit";
import { NotesEdit } from "@/components/vessel-edit/NotesEdit";
import { StorageEdit } from "@/components/vessel-edit/StorageEdit";
import { ContactEdit } from "@/components/vessel-edit/ContactEdit";
import { EmergencyEdit } from "@/components/vessel-edit/EmergencyEdit";
import { RegistrationEdit } from "@/components/vessel-edit/RegistrationEdit";
import { RequestIdentityCorrection } from "@/components/vessel-edit/RequestIdentityCorrection";
import { RequestDecommission } from "@/components/vessel-edit/RequestDecommission";
import { TransferOwnershipPanel, type ActiveTransfer } from "@/components/vessel-edit/TransferOwnershipPanel";
import { DeleteUnactivatedVesselButton } from "@/components/vessel-edit/DeleteUnactivatedVesselButton";
import { DocumentsEdit } from "@/components/vessel-edit/DocumentsEdit";
import { InsuranceEdit } from "@/components/vessel-edit/InsuranceEdit";
import { SafetyEdit } from "@/components/vessel-edit/SafetyEdit";
import { ShareSheet } from "@/components/share/ShareSheet";
import type { BillingSummary } from "@/lib/billing-service";
import { DECOMMISSION_REASON_LABELS, type DecommissionReason } from "@/lib/vessel-decommission";
import { getDormantInfo } from "@/lib/vessel-dormancy";

export type OwnerProfileTier = PublicProfileProps & {
  qr_status?: string | null;
  lifecycle_status?: string | null;
  decommission_reason?: string | null;
  dormant_cause?: string | null;
  slip_number?: string | null;
  marina_phone?: string | null;
  is_liveaboard?: boolean | null;
  slip_notes?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  owner_email?: string | null;
  preferred_contact?: string | null;
  emg_name?: string | null;
  emg_phone?: string | null;
  emg_relationship?: string | null;
  ins_carrier?: string | null;
  ins_broker?: string | null;
  ins_policy?: string | null;
  ins_expiry?: string | null;
  ins_liability?: string | null;
  hin?: string | null;
  uscg_doc_number?: string | null;
  official_number?: string | null;
  reg_state?: string | null;
  reg_number?: string | null;
  reg_expiry?: string | null;
  engine?: string | null;
  fuel_type?: string | null;
  max_persons?: number | null;
  lifejackets?: number | null;
  fire_extinguisher?: boolean | null;
  flares?: boolean | null;
  sound_device?: boolean | null;
  ca_boater_card?: boolean | null;
  doc_registration_url?: string | null;
  doc_insurance_url?: string | null;
  doc_boater_card_url?: string | null;
};

function Row({ label, value }: { label: string; value: string | number | boolean | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  const display =
    typeof value === "boolean" ? (value ? "Yes" : "No") : String(value);
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0">
      <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">
        {label}
      </dt>
      <dd className="text-right font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{display}</dd>
    </div>
  );
}

export function VesselOwnerProfile({
  tier,
  billing,
  justUpgraded = false,
  hasPendingDecommissionRequest = false,
  activeTransfer = null,
  singleVessel = false,
  documentMeta = {},
}: {
  tier: OwnerProfileTier;
  billing: BillingSummary;
  justUpgraded?: boolean;
  hasPendingDecommissionRequest?: boolean;
  /** True when this is the owner's only active vessel — drives the automatic-caching default (build spec §8 decision 2). */
  singleVessel?: boolean;
  activeTransfer?: ActiveTransfer | null;
  /** Upload date/size/original filename per document, resolved server-side in [mxeId]/page.tsx. */
  documentMeta?: VesselDocumentMeta;
}) {
  const publicProps: PublicProfileProps = {
    mxe_id: tier.mxe_id,
    vessel_name: tier.vessel_name,
    vessel_type: tier.vessel_type,
    make: tier.make,
    model: tier.model,
    year: tier.year,
    length_ft: tier.length_ft,
    draft_ft: tier.draft_ft,
    public_notes: tier.public_notes,
    photo_url: tier.photo_url,
    storage_type: tier.storage_type,
    storage_description: tier.storage_description,
    storage_state: tier.storage_state,
    storage_city: tier.storage_city,
    marina_name: tier.marina_name,
    marina_city: tier.marina_city,
  };

  // Same marina+mooring grouping as VesselPublicProfile — the owner-only
  // slip/marina detail section only makes sense for that group.
  const isMarinaStorage =
    tier.storage_type == null || tier.storage_type === "marina" || tier.storage_type === "mooring";

  // Unlike the public page (which gates on this before ever reaching
  // VesselPublicProfile), the owner view has always rendered regardless
  // of activation state — there was previously no way for an owner to
  // even tell, from here, that checkout never finished. Not
  // dismissible: the underlying problem persists until the badge fee is
  // actually paid, so this stays visible on every visit rather than
  // being closeable once and forgotten.
  const needsActivation = tier.qr_status != null && tier.qr_status !== "active";
  const isDecommissioned = tier.lifecycle_status === "decommissioned";
  // Dormant Vessel Identity (docs/moxie_digital_dormant_identity_spec.md
  // §3): document access, sharing, and editing all suspend while
  // dormant — lock-don't-delete, same principle already established for
  // Basic's document limit. isDecommissioned above stays its own flag
  // (its banner/copy differs), but dormant.isDormant is true for it too,
  // so the shared editing/sharing lock below covers all three causes.
  const dormant = getDormantInfo({ lifecycle_status: tier.lifecycle_status ?? null, dormant_cause: tier.dormant_cause ?? null });

  // Which documents "save for offline" should fetch — same Basic-tier
  // lock DocumentsEdit.tsx enforces (registration counted first,
  // insurance second, boater_card always exempt), so offline access
  // never covers a document that isn't viewable online either (build
  // spec §6). The API route re-checks this itself server-side; this is
  // just what the client asks for.
  const docSlots: DocumentSlot[] = [
    { docType: "registration", url: tier.doc_registration_url ?? null },
    { docType: "insurance", url: tier.doc_insurance_url ?? null },
  ];
  // Nudge condition (ExpiryDateNudge): the document exists but the date
  // that describes it doesn't. Nothing to ask for when there's no
  // document yet — the upload flow prompts inline at that point instead.
  const missingRegExpiry = !!tier.doc_registration_url && !tier.reg_expiry;
  const missingInsExpiry = !!tier.doc_insurance_url && !tier.ins_expiry;

  const availableDocs: OfflineDocType[] = [
    ...docSlots
      .filter((slot, i) => slot.url && !isDocumentLocked(docSlots, i, billing.subscriptionTier))
      .map((slot) => slot.docType as OfflineDocType),
    ...(tier.doc_boater_card_url ? (["boater_card"] as OfflineDocType[]) : []),
  ];

  // Cache-key input only, not display data — see lib/document-url.ts. The
  // offline save writes each document under a URL derived from these, and
  // stores them alongside so the offline read can rebuild the same URL
  // with no server to ask.
  const docVersions: Partial<Record<OfflineDocType, string | null>> = Object.fromEntries(
    availableDocs.map((docType) => [docType, documentMeta[docType]?.uploadedAt ?? null]),
  );

  return (
    <>
      <BfcacheRefresh />
      <AppHeader role="Owner" wordmarkHref="/dashboard">
        <Link
          href={`/dashboard/${encodeURIComponent(tier.mxe_id)}/shares`}
          className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)] transition hover:text-[var(--gold)]"
        >
          Shares
        </Link>
        <AccountBillingPanel billing={billing} />
        <SignOutButton />
      </AppHeader>

      {isDecommissioned ? (
        <div className="border-b border-[var(--divider)] bg-[var(--gray-bg)] px-5 py-4 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gray-fg)]">
            This vessel has been decommissioned{" "}
            {tier.decommission_reason
              ? `(${DECOMMISSION_REASON_LABELS[tier.decommission_reason as DecommissionReason] ?? tier.decommission_reason})`
              : null}
            .
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--gray-fg)]">
            It&apos;s no longer part of your active fleet and doesn&apos;t count against your vessel limit. The
            record, documents, and history are all still here — contact us if you need it reactivated.
          </p>
        </div>
      ) : dormant.cause === "lapsed" ? (
        <div className="border-b border-[var(--red-fg)] bg-[var(--red-bg)] px-5 py-4 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--red-fg)]">
            This vessel is dormant — your subscription has lapsed.
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
            Document access, sharing, and editing are paused. Nothing is deleted — resubscribe to restore this vessel
            and the rest of your fleet.
          </p>
          <Link
            href="/dashboard/upgrade"
            className="mt-3 inline-flex rounded-lg bg-[var(--red-fg)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-white"
          >
            Choose a plan →
          </Link>
        </div>
      ) : dormant.cause === "locked" ? (
        <div className="border-b border-[var(--red-fg)] bg-[var(--red-bg)] px-5 py-4 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--red-fg)]">
            This vessel is dormant — it&apos;s beyond your Basic plan&apos;s vessel limit.
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
            Document access, sharing, and editing are paused. Nothing is deleted — upgrade to Full to restore every
            vessel, or choose which stay active on Basic.
          </p>
          <div className="mt-3 flex flex-wrap justify-center gap-2.5">
            <Link
              href="/dashboard/upgrade"
              className="inline-flex rounded-lg bg-[var(--red-fg)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-white"
            >
              Upgrade to Full →
            </Link>
            <Link
              href="/dashboard/manage-fleet"
              className="inline-flex rounded-lg border border-[var(--red-fg)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--red-fg)]"
            >
              Choose active vessels →
            </Link>
          </div>
        </div>
      ) : needsActivation ? (
        <div className="border-b border-[var(--red-fg)] bg-[var(--red-bg)] px-5 py-4 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--red-fg)]">
            This vessel isn&apos;t active yet — the badge fee hasn&apos;t been paid.
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">
            No badge ships and no public profile goes live until this is finished.
          </p>
          <Link
            href={`/dashboard/${encodeURIComponent(tier.mxe_id)}/payment`}
            className="mt-3 inline-flex rounded-lg bg-[var(--red-fg)] px-5 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-white"
          >
            Finish activating this vessel →
          </Link>
          <div className="mt-3">
            <DeleteUnactivatedVesselButton mxeId={tier.mxe_id} vesselName={tier.vessel_name} redirectTo="/dashboard" />
          </div>
        </div>
      ) : null}

      {justUpgraded ? (
        <div className="border-b border-[var(--divider)] bg-[var(--green-bg)] px-5 py-3 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--green-fg)]">
            ✓ You&apos;re on {billing.subscriptionTier === "full" ? "Full Access" : "Basic"} — welcome aboard.
          </p>
        </div>
      ) : null}

      <VesselPublicProfile {...publicProps} hideFooter />

      {/*
        Dormant lock (spec §3: "Vessel editing" suspended while dormant,
        covering all three causes including decommissioned — a gap this
        fix closes, since editing was previously left fully open for an
        already-decommissioned vessel too). A CSS-level lock across the
        whole editable block rather than threading a `disabled` prop
        through nine separate Edit components individually — every
        control in here is genuinely inert (pointer-events-none), not
        just visually dimmed, and the banner above already explains why.
      */}
      <div className={dormant.isDormant ? "pointer-events-none opacity-60" : undefined} aria-disabled={dormant.isDormant}>
        {!tier.photo_url ? <AddPhotoNudge mxeId={tier.mxe_id} vesselName={tier.vessel_name} /> : null}
        {missingRegExpiry || missingInsExpiry ? (
          <ExpiryDateNudge
            mxeId={tier.mxe_id}
            missingRegistration={missingRegExpiry}
            missingInsurance={missingInsExpiry}
          />
        ) : null}

        <div className="mx-auto flex max-w-lg flex-col items-end gap-3 px-5 md:px-8">
        {tier.photo_url ? <ReplacePhotoControl mxeId={tier.mxe_id} /> : null}
        <VesselDetailsEdit mxeId={tier.mxe_id} vessel_name={tier.vessel_name} />
        <NotesEdit mxeId={tier.mxe_id} public_notes={tier.public_notes} />
        <RequestIdentityCorrection
          mxeId={tier.mxe_id}
          currentValues={{
            hin: tier.hin,
            make: tier.make,
            model: tier.model,
            year: tier.year,
            length_ft: tier.length_ft,
            draft_ft: tier.draft_ft,
            engine: tier.engine,
          }}
        />
        {!isDecommissioned ? (
          <RequestDecommission mxeId={tier.mxe_id} hasPendingRequest={hasPendingDecommissionRequest} />
        ) : null}
        {!isDecommissioned && !needsActivation ? (
          <TransferOwnershipPanel mxeId={tier.mxe_id} activeTransfer={activeTransfer} />
        ) : null}
      </div>

      <section className="mx-auto max-w-lg px-5 pb-10 md:px-8">
        <div className="flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Storage
          </h2>
          <StorageEdit
            mxeId={tier.mxe_id}
            storage_type={tier.storage_type}
            storage_description={tier.storage_description}
            storage_state={tier.storage_state}
            storage_city={tier.storage_city}
            marina_name={tier.marina_name}
            marina_city={tier.marina_city}
            slip_number={tier.slip_number}
            marina_phone={tier.marina_phone}
            is_liveaboard={tier.is_liveaboard}
            slip_notes={tier.slip_notes}
          />
        </div>
        {isMarinaStorage ? (
          <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
            <Row label="Slip" value={tier.slip_number} />
            <Row label="Marina phone" value={tier.marina_phone} />
            <Row label="Liveaboard" value={tier.is_liveaboard ?? null} />
            <Row label="Slip notes" value={tier.slip_notes} />
          </dl>
        ) : null}

        <div className="mt-12 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Contact
          </h2>
          <ContactEdit
            mxeId={tier.mxe_id}
            owner_name={tier.owner_name}
            owner_phone={tier.owner_phone}
            owner_email={tier.owner_email}
            preferred_contact={tier.preferred_contact}
          />
        </div>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Owner name" value={tier.owner_name} />
          <Row label="Owner phone" value={tier.owner_phone} />
          <Row label="Owner email" value={tier.owner_email} />
          <Row label="Preferred contact" value={tier.preferred_contact} />
        </dl>

        <div className="mt-12 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Emergency
          </h2>
          <EmergencyEdit
            mxeId={tier.mxe_id}
            emg_name={tier.emg_name}
            emg_phone={tier.emg_phone}
            emg_relationship={tier.emg_relationship}
          />
        </div>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Name" value={tier.emg_name} />
          <Row label="Phone" value={tier.emg_phone} />
          <Row label="Relationship" value={tier.emg_relationship} />
        </dl>

        <div className="mt-12 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Registration &amp; documentation
          </h2>
          <RegistrationEdit
            mxeId={tier.mxe_id}
            reg_state={tier.reg_state}
            reg_number={tier.reg_number}
            reg_expiry={tier.reg_expiry}
          />
        </div>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="HIN" value={tier.hin} />
          <Row label="USCG doc #" value={tier.uscg_doc_number} />
          <Row label="Official number" value={tier.official_number} />
          <Row label="Reg. state" value={tier.reg_state} />
          <Row label="Reg. number" value={tier.reg_number} />
          <Row label="Reg. expiry" value={tier.reg_expiry} />
        </dl>

        <h3
          id="documents"
          className="mt-6 scroll-mt-20 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]"
        >
          Documents on file
        </h3>
        <div className="mt-3">
          <SaveOfflineControl
            identity={{
              mxeId: tier.mxe_id,
              vesselName: tier.vessel_name,
              make: tier.make,
              model: tier.model,
              year: tier.year,
              hin: tier.hin ?? null,
              regState: tier.reg_state ?? null,
              regNumber: tier.reg_number ?? null,
              ownerName: tier.owner_name ?? null,
              ownerPhone: tier.owner_phone ?? null,
              emgName: tier.emg_name ?? null,
              emgPhone: tier.emg_phone ?? null,
              photoUrl: tier.photo_url ?? null,
              availableDocs,
              docVersions,
            }}
            autoSave={singleVessel}
            disabled={dormant.isDormant || needsActivation}
          />
        </div>
        <DocumentsEdit
          mxeId={tier.mxe_id}
          doc_registration_url={tier.doc_registration_url}
          doc_insurance_url={tier.doc_insurance_url}
          doc_boater_card_url={tier.doc_boater_card_url}
          ca_boater_card={tier.ca_boater_card}
          subscriptionTier={billing.subscriptionTier}
          documentMeta={documentMeta}
          regExpiry={tier.reg_expiry}
          insExpiry={tier.ins_expiry}
        />

        <div className="mt-12 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Insurance
          </h2>
          <InsuranceEdit
            mxeId={tier.mxe_id}
            ins_carrier={tier.ins_carrier}
            ins_broker={tier.ins_broker}
            ins_policy={tier.ins_policy}
            ins_expiry={tier.ins_expiry}
            ins_liability={tier.ins_liability}
          />
        </div>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Carrier" value={tier.ins_carrier} />
          <Row label="Broker" value={tier.ins_broker} />
          <Row label="Policy" value={tier.ins_policy} />
          <Row label="Expiry" value={tier.ins_expiry} />
          <Row label="Liability" value={tier.ins_liability} />
        </dl>

        <div className="mt-12 flex items-center justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
            Propulsion &amp; safety
          </h2>
          <SafetyEdit
            mxeId={tier.mxe_id}
            fuel_type={tier.fuel_type}
            max_persons={tier.max_persons}
            lifejackets={tier.lifejackets}
            fire_extinguisher={tier.fire_extinguisher}
            flares={tier.flares}
            sound_device={tier.sound_device}
          />
        </div>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Engine" value={tier.engine} />
          <Row label="Fuel" value={tier.fuel_type} />
          <Row label="Max persons" value={tier.max_persons} />
          <Row label="Life jackets" value={tier.lifejackets} />
          <Row label="Fire extinguisher" value={tier.fire_extinguisher ?? null} />
          <Row label="Flares" value={tier.flares ?? null} />
          <Row label="Sound device" value={tier.sound_device ?? null} />
        </dl>

        <footer className="mt-16 border-t border-[var(--divider)] pt-8 text-center">
          <p className="font-[family-name:var(--font-display)] text-lg italic text-[var(--navy)]">
            <span className="text-[var(--gold)]">M</span>oxie
          </p>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
            Owner vessel profile
          </p>
        </footer>
      </section>
      </div>

      {/* No new Trusted Contact shares while dormant (spec §3) — existing
          ones are already revoked server-side (set_vessels_lapsed /
          apply_overflow_fallback / apply_vessel_decommission). Not
          rendering the button at all, rather than rendering it disabled,
          since there's nothing left for it to do here. */}
      {!dormant.isDormant ? <ShareSheet mxeId={tier.mxe_id} vesselName={tier.vessel_name} /> : null}
    </>
  );
}
