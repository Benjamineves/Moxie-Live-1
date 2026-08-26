import { VesselPublicProfile, type PublicProfileProps } from "@/components/VesselPublicProfile";
import { SignOutButton } from "@/components/SignOutButton";

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

export function VesselOwnerProfile({ tier }: { tier: OwnerProfileTier }) {
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
    marina_name: tier.marina_name,
    marina_city: tier.marina_city,
  };

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-[var(--divider)] bg-[var(--navy-deep)] px-5 py-4">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3">
          <p className="font-[family-name:var(--font-display)] text-lg font-light italic text-white">
            <span className="text-[var(--gold)]">M</span>oxie
          </p>
          <div className="flex items-center gap-4">
            <span className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.2em] text-[rgba(255,255,255,.55)]">
              Owner
            </span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <VesselPublicProfile {...publicProps} hideFooter />

      <section className="mx-auto max-w-lg px-5 pb-10 md:px-8">
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Slip &amp; marina
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Slip" value={tier.slip_number} />
          <Row label="Marina phone" value={tier.marina_phone} />
          <Row label="Liveaboard" value={tier.is_liveaboard ?? null} />
          <Row label="Slip notes" value={tier.slip_notes} />
        </dl>

        <h2 className="mt-12 font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Contact
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Owner name" value={tier.owner_name} />
          <Row label="Owner phone" value={tier.owner_phone} />
          <Row label="Owner email" value={tier.owner_email} />
          <Row label="Preferred contact" value={tier.preferred_contact} />
        </dl>

        <h2 className="mt-12 font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Emergency
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Name" value={tier.emg_name} />
          <Row label="Phone" value={tier.emg_phone} />
          <Row label="Relationship" value={tier.emg_relationship} />
        </dl>

        <h2 className="mt-12 font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Registration &amp; documentation
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="HIN" value={tier.hin} />
          <Row label="USCG doc #" value={tier.uscg_doc_number} />
          <Row label="Official number" value={tier.official_number} />
          <Row label="Reg. state" value={tier.reg_state} />
          <Row label="Reg. number" value={tier.reg_number} />
          <Row label="Reg. expiry" value={tier.reg_expiry} />
        </dl>

        <h2 className="mt-12 font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Insurance
        </h2>
        <dl className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
          <Row label="Carrier" value={tier.ins_carrier} />
          <Row label="Broker" value={tier.ins_broker} />
          <Row label="Policy" value={tier.ins_policy} />
          <Row label="Expiry" value={tier.ins_expiry} />
          <Row label="Liability" value={tier.ins_liability} />
        </dl>

        <h2 className="mt-12 font-[family-name:var(--font-display)] text-2xl font-light text-[var(--navy)]">
          Propulsion &amp; safety
        </h2>
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
    </>
  );
}
