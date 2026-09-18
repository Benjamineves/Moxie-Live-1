import type { ReactNode } from "react";
import Link from "next/link";
import type { EmergencyContact, MarinaDocumentState, MarinaView } from "@/lib/marina-view";
import { getExpiryStatus } from "@/lib/document-expiry";
import { MarinaDocument } from "./MarinaDocument";

/**
 * The marina view (docs/moxie_digital_marina_access_spec.md §2.2), rendered
 * from buildMarinaView and nothing else — this component never sees a
 * vessel row, so it cannot show a field the projection didn't release.
 *
 * Every row renders, whatever its state. A missing emergency contact says
 * so; a document is "on file", "none on file" or "not shared with you".
 * The harbormaster should never have to guess whether something is absent
 * or withheld, and "none on file" is the nudge — delivered by them, not us.
 */

const label = "font-[family-name:var(--font-dm)] text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--text3)]";
const value = "font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]";
const absent = "font-[family-name:var(--font-dm)] text-sm italic text-[var(--text2)]";
const linkClass = "underline underline-offset-2";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5">
      <h2 className={label}>{title}</h2>
      <div className="mt-3 space-y-2">{children}</div>
    </section>
  );
}

function Line({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <span className="shrink-0 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{name}</span>
      <span className="min-w-0 text-right">{children}</span>
    </div>
  );
}

function Phone({ phone }: { phone: string | null }) {
  if (!phone) return <span className={absent}>Not provided</span>;
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, "")}`} className={`${value} ${linkClass}`}>
      {phone}
    </a>
  );
}

/** Used on the marina view and on the dormant screen, where it is the only detail left. */
export function MarinaEmergencyContact({ emergency }: { emergency: EmergencyContact | null }) {
  return (
    <Section title="Emergency contact">
      {emergency ? (
        <>
          <Line name="Name">
            {emergency.name ? <span className={value}>{emergency.name}</span> : <span className={absent}>Not provided</span>}
          </Line>
          <Line name="Phone">
            <Phone phone={emergency.phone} />
          </Line>
          <Line name="Relationship">
            {emergency.relationship ? (
              <span className={value}>{emergency.relationship}</span>
            ) : (
              <span className={absent}>Not provided</span>
            )}
          </Line>
        </>
      ) : (
        <p className={absent}>No emergency contact on file.</p>
      )}
    </Section>
  );
}

function DocumentRow({
  mxeId,
  docType,
  title,
  doc,
}: {
  mxeId: string;
  docType: "registration" | "insurance";
  title: string;
  doc: MarinaDocumentState;
}) {
  if (doc.state === "not_shared") {
    return (
      <Line name={title}>
        <span className={absent}>Not shared with you</span>
      </Line>
    );
  }
  if (doc.state === "missing") {
    return (
      <Line name={title}>
        <span className={absent}>No {title.toLowerCase()} document on file</span>
      </Line>
    );
  }
  // Owner-entered, and labelled as such: we hold the certificate, not a
  // verified date. Same principle as logged_at on service records.
  const expiry = doc.ownerEnteredExpiry ? getExpiryStatus(doc.ownerEnteredExpiry) : null;
  return (
    <div className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">{title}</p>
        {expiry ? (
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            {expiry.label} · <span className="italic">entered by the owner, not verified</span>
          </p>
        ) : null}
      </div>
      <MarinaDocument mxeId={mxeId} docType={docType} label={`${title} document`} format={doc.format} />
    </div>
  );
}

export function MarinaVesselProfile({ view, marinaName }: { view: MarinaView; marinaName: string }) {
  return (
    <main className="mx-auto w-full max-w-lg space-y-4 px-4 py-6">
      <Link href="/marina" className="inline-block font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--gold-deep)] underline underline-offset-2">
        ← {marinaName} roster
      </Link>
      <header className="flex items-center gap-4">
        {view.photo_url?.startsWith("http") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={view.photo_url} alt={view.vessel_name} className="h-20 w-20 shrink-0 rounded-xl object-cover" />
        ) : null}
        <div className="min-w-0">
          <p className="font-[family-name:var(--font-dm)] text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--text3)]">
            {view.mxe_id}
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
            {view.vessel_name}
          </h1>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {[view.year, view.make, view.model].filter(Boolean).join(" ")}
          </p>
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
            {view.slip ? `Slip ${view.slip}` : <span className="font-normal italic text-[var(--text2)]">No slip number given</span>}
          </p>
        </div>
      </header>

      <p className="rounded-lg bg-[var(--cream2)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
        Shared with <span className="font-semibold text-[var(--navy)]">{marinaName}</span> by the owner.
      </p>

      <Section title="Owner">
        <Line name="Name">
          {view.owner.name ? <span className={value}>{view.owner.name}</span> : <span className={absent}>Not provided</span>}
        </Line>
        <Line name="Phone">
          <Phone phone={view.owner.phone} />
        </Line>
        <Line name="Email">
          {view.owner.email ? (
            <a href={`mailto:${view.owner.email}`} className={`${value} ${linkClass} break-all`}>
              {view.owner.email}
            </a>
          ) : (
            <span className={absent}>Not provided</span>
          )}
        </Line>
      </Section>

      <MarinaEmergencyContact emergency={view.emergency} />

      <Section title="Documents">
        <DocumentRow mxeId={view.mxe_id} docType="registration" title="Registration" doc={view.registration} />
        <DocumentRow mxeId={view.mxe_id} docType="insurance" title="Insurance" doc={view.insurance} />
      </Section>
    </main>
  );
}

/**
 * Shown above the public profile to a signed-in marina user the owner
 * hasn't shared with. It discloses one fact the public profile doesn't —
 * that THIS marina has no access, a fact about the marina's own
 * relationships — and nothing about any other marina (spec §6.3).
 */
export function MarinaNotSharedBanner({ marinaName }: { marinaName: string }) {
  return (
    <div className="border-b border-[var(--divider)] bg-[var(--cream2)] px-5 py-3">
      <p className="mx-auto max-w-lg font-[family-name:var(--font-dm)] text-sm text-[var(--navy)]">
        <span className="font-semibold">Not shared with {marinaName}.</span>{" "}
        <span className="text-[var(--text2)]">
          The owner hasn&apos;t shared their contact details with you. Ask them to enter your marina&apos;s code.
        </span>
      </p>
    </div>
  );
}
