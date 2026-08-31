import Link from "next/link";
import type { FilteredShareVessel } from "@/lib/share-filter";

function Row({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0">
      <dt className="font-[family-name:var(--font-dm)] text-xs uppercase tracking-[0.12em] text-[var(--text3)]">{label}</dt>
      <dd className="text-right font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{value}</dd>
    </div>
  );
}

function fileNameFromPath(path: string) {
  return path.split("/").pop() || path;
}

export function SharedVesselProfile({
  vessel,
  sharedBy,
  label,
  expiresAt,
}: {
  vessel: FilteredShareVessel;
  sharedBy: string | null;
  label: string | null;
  expiresAt: string | null;
}) {
  const hasLocation = vessel.marina_name !== undefined;
  const hasContact = vessel.owner_name !== undefined;
  const hasDocs = vessel.doc_registration_url !== undefined;
  const hasOwnership = vessel.hin !== undefined;
  const hasAccess = vessel.access_note !== undefined;

  const isMarinaStorage =
    vessel.storage_type == null || vessel.storage_type === "marina" || vessel.storage_type === "mooring";

  return (
    <div className="min-h-screen bg-[var(--cream)]">
      <header className="bg-gradient-to-r from-[var(--aqua-abyss)] to-[#0d3830] px-5 py-2.5">
        <div className="mx-auto flex max-w-lg items-center justify-between">
          <div className="flex items-center gap-2.5">
            <p className="font-[family-name:var(--font-display)] text-base font-light italic text-white">
              <span className="text-[var(--gold)]">M</span>oxie
            </p>
            <span className="rounded-full border border-[rgba(23,195,178,.3)] bg-[rgba(23,195,178,.2)] px-2.5 py-0.5 font-[family-name:var(--font-dm)] text-[8px] font-medium uppercase tracking-[0.16em] text-[#7fe8dc]">
              Shared Profile
            </span>
          </div>
          {expiresAt ? (
            <span className="font-[family-name:var(--font-dm)] text-[10px] uppercase tracking-[0.1em] text-[rgba(255,255,255,.4)]">
              Expires {new Date(expiresAt).toLocaleString()}
            </span>
          ) : null}
        </div>
      </header>

      {sharedBy ? (
        <div className="flex items-center gap-3 border-b border-[rgba(23,195,178,.15)] bg-[rgba(23,195,178,.06)] px-5 py-3.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--navy)] font-[family-name:var(--font-display)] text-sm italic text-[var(--gold)]">
            {sharedBy.charAt(0)}
          </div>
          <p className="flex-1 font-[family-name:var(--font-dm)] text-xs leading-snug text-[var(--text2)]">
            <strong className="text-[var(--navy)]">{sharedBy}</strong> shared this vessel profile with you
            {label ? ` (${label})` : ""}. You&apos;re seeing details the owner chose to include.
          </p>
        </div>
      ) : null}

      <header className="border-b border-[var(--divider)] bg-[var(--navy-deep)] px-5 pb-6 pt-8">
        <div className="mx-auto max-w-lg">
          <p className="font-[family-name:var(--font-dm)] text-[10px] font-medium uppercase tracking-[0.22em] text-[rgba(255,255,255,.4)]">
            {vessel.mxe_id}
          </p>
          <h1 className="mt-1 font-[family-name:var(--font-display)] text-4xl font-light italic text-white">
            {vessel.vessel_name}
          </h1>
          <p className="mt-1 font-[family-name:var(--font-dm)] text-sm text-[rgba(255,255,255,.55)]">
            {vessel.make} {vessel.model} · {vessel.year}
            {vessel.vessel_type ? ` · ${vessel.vessel_type}` : ""}
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-lg pb-16">
        <div className="grid grid-cols-3 border-b border-[var(--divider)] bg-[var(--white)]">
          {[
            ["Length", vessel.length_ft != null ? `${vessel.length_ft} ft` : null],
            ["Draft", vessel.draft_ft != null ? `${vessel.draft_ft} ft` : null],
            ["Engine", vessel.engine],
          ].map(([k, v]) =>
            v ? (
              <div key={k} className="border-r border-[var(--divider)] p-4 last:border-r-0">
                <p className="mb-0.5 font-[family-name:var(--font-dm)] text-[9px] uppercase tracking-[0.12em] text-[var(--text3)]">{k}</p>
                <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">{v}</p>
              </div>
            ) : null,
          )}
        </div>

        {hasLocation ? (
          <section className="border-b border-[var(--divider)] bg-[var(--white)] px-5 py-5">
            <p className="mb-3 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
              Location
            </p>
            {isMarinaStorage ? (
              <dl>
                <Row
                  label="Marina"
                  value={[vessel.marina_name, vessel.marina_city].filter(Boolean).join(", ") || null}
                />
                <Row label="Slip" value={vessel.slip_number} />
                <Row label="Marina phone" value={vessel.marina_phone} />
              </dl>
            ) : (
              <dl>
                <Row label="Storage" value={vessel.storage_description} />
              </dl>
            )}
          </section>
        ) : null}

        {hasContact ? (
          <section className="border-b border-[var(--divider)] bg-[var(--white)] px-5 py-5">
            <p className="mb-3 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
              Owner Contact
            </p>
            <dl>
              <Row label="Owner" value={vessel.owner_name} />
              <Row label="Phone" value={vessel.owner_phone} />
            </dl>
          </section>
        ) : null}

        {hasAccess && vessel.access_note ? (
          <section className="border-b border-[var(--divider)] bg-[var(--white)] px-5 py-5">
            <p className="mb-3 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
              Access &amp; Instructions
            </p>
            <div className="rounded-lg border border-[rgba(23,195,178,.15)] bg-[rgba(23,195,178,.05)] p-3.5">
              <p className="mb-1 font-[family-name:var(--font-dm)] text-[10px] font-medium text-[var(--text3)]">
                {sharedBy ? `Note from ${sharedBy.split(" ")[0]}` : "Note from owner"}
              </p>
              <p className="font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--navy)]">{vessel.access_note}</p>
            </div>
          </section>
        ) : null}

        {hasDocs ? (
          <section className="border-b border-[var(--divider)] bg-[var(--white)] px-5 py-5">
            <p className="mb-3 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
              Documents
            </p>
            <dl>
              <Row label="Registration" value={vessel.doc_registration_url ? fileNameFromPath(vessel.doc_registration_url) : "Not on file"} />
              <Row label="Insurance" value={vessel.doc_insurance_url ? fileNameFromPath(vessel.doc_insurance_url) : "Not on file"} />
              <Row label="CA boater card" value={vessel.doc_boater_card_url ? fileNameFromPath(vessel.doc_boater_card_url) : "Not on file"} />
            </dl>
          </section>
        ) : null}

        {hasOwnership ? (
          <section className="border-b border-[var(--divider)] bg-[var(--white)] px-5 py-5">
            <p className="mb-3 font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.2em] text-[var(--text3)]">
              Ownership Record
            </p>
            <dl>
              <Row label="HIN" value={vessel.hin} />
              <Row label="USCG doc #" value={vessel.uscg_doc_number} />
              <Row label="Official number" value={vessel.official_number} />
              <Row label="Reg. state" value={vessel.reg_state} />
              <Row label="Reg. number" value={vessel.reg_number} />
              <Row label="Reg. expiry" value={vessel.reg_expiry} />
            </dl>
          </section>
        ) : null}

        {vessel.public_notes ? (
          <section className="px-5 py-5">
            <p className="mb-2 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text3)]">
              About this vessel
            </p>
            <p className="font-[family-name:var(--font-dm)] text-sm font-light leading-relaxed text-[var(--text2)]">
              {vessel.public_notes}
            </p>
          </section>
        ) : null}

        <div className="mx-5 mt-2 flex items-center gap-4 rounded-xl bg-[var(--navy)] p-5">
          <div className="flex-1">
            <p className="font-[family-name:var(--font-dm)] text-[9px] font-medium uppercase tracking-[0.16em] text-[rgba(255,255,255,.4)]">
              Own a vessel?
            </p>
            <p className="mt-1 font-[family-name:var(--font-display)] text-lg italic text-white">
              Get your boat on <span className="text-[var(--gold)]">Moxie.</span>
            </p>
          </div>
          <Link
            href="/"
            className="shrink-0 bg-[var(--gold)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--navy)]"
          >
            Learn more
          </Link>
        </div>
      </main>
    </div>
  );
}
