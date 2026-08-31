import Link from "next/link";
import { VesselPublicProfile, type PublicProfileProps } from "@/components/VesselPublicProfile";
import { SignOutButton } from "@/components/SignOutButton";
import { AccountBillingPanel } from "@/components/AccountBillingPanel";
import { AddPhotoNudge } from "@/components/AddPhotoNudge";
import { ReplacePhotoControl } from "@/components/ReplacePhotoControl";
import { BfcacheRefresh } from "@/components/BfcacheRefresh";
import { VesselDetailsEdit } from "@/components/vessel-edit/VesselDetailsEdit";
import { NotesEdit } from "@/components/vessel-edit/NotesEdit";
import { StorageEdit } from "@/components/vessel-edit/StorageEdit";
import { ContactEdit } from "@/components/vessel-edit/ContactEdit";
import { EmergencyEdit } from "@/components/vessel-edit/EmergencyEdit";
import { RegistrationEdit } from "@/components/vessel-edit/RegistrationEdit";
import { RequestIdentityCorrection } from "@/components/vessel-edit/RequestIdentityCorrection";
import { DocumentsEdit } from "@/components/vessel-edit/DocumentsEdit";
import { InsuranceEdit } from "@/components/vessel-edit/InsuranceEdit";
import { SafetyEdit } from "@/components/vessel-edit/SafetyEdit";
import { ShareSheet } from "@/components/share/ShareSheet";
import type { BillingSummary } from "@/lib/billing-service";

export type OwnerProfileTier = PublicProfileProps & {
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
}: {
  tier: OwnerProfileTier;
  billing: BillingSummary;
  justUpgraded?: boolean;
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
    marina_name: tier.marina_name,
    marina_city: tier.marina_city,
  };

  // Same marina+mooring grouping as VesselPublicProfile — the owner-only
  // slip/marina detail section only makes sense for that group.
  const isMarinaStorage =
    tier.storage_type == null || tier.storage_type === "marina" || tier.storage_type === "mooring";

  return (
    <>
      <BfcacheRefresh />
      <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-5 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <Link
            href="/dashboard"
            className="font-[family-name:var(--font-display)] text-lg font-light italic text-white"
          >
            <span className="text-[var(--gold)]">M</span>oxie
          </Link>
          <div className="flex items-center gap-4">
            <span className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)]">
              Owner
            </span>
            <Link
              href={`/dashboard/${encodeURIComponent(tier.mxe_id)}/shares`}
              className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)] transition hover:text-[var(--gold)]"
            >
              Shares
            </Link>
            <AccountBillingPanel billing={billing} mxeId={tier.mxe_id} />
            <SignOutButton />
          </div>
        </div>
      </header>

      {justUpgraded ? (
        <div className="border-b border-[var(--divider)] bg-[var(--green-bg)] px-5 py-3 text-center">
          <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--green-fg)]">
            ✓ You&apos;re on Full Access — welcome to the upgrade.
          </p>
        </div>
      ) : null}

      <VesselPublicProfile {...publicProps} hideFooter />

      {!tier.photo_url ? (
        <AddPhotoNudge mxeId={tier.mxe_id} vesselName={tier.vessel_name} />
      ) : (
        <ReplacePhotoControl mxeId={tier.mxe_id} />
      )}

      <div className="mx-auto flex max-w-lg justify-end gap-4 px-5 md:px-8">
        <VesselDetailsEdit mxeId={tier.mxe_id} vessel_name={tier.vessel_name} />
        <NotesEdit mxeId={tier.mxe_id} public_notes={tier.public_notes} />
      </div>

      <div className="mx-auto max-w-lg px-5 md:px-8">
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

        <h3 className="mt-6 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]">
          Documents on file
        </h3>
        <DocumentsEdit
          mxeId={tier.mxe_id}
          doc_registration_url={tier.doc_registration_url}
          doc_insurance_url={tier.doc_insurance_url}
          doc_boater_card_url={tier.doc_boater_card_url}
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
            ca_boater_card={tier.ca_boater_card}
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
          <Row label="CA boater card" value={tier.ca_boater_card ?? null} />
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

      <ShareSheet mxeId={tier.mxe_id} vesselName={tier.vessel_name} subscriptionTier={billing.subscriptionTier} />
    </>
  );
}
