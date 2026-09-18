/**
 * What a marina sees. The ONE definition — docs/moxie_digital_marina_access_spec.md §2.2.
 *
 * Owner contact, emergency contact, the slip number, and the registration
 * and insurance DOCUMENTS where the owner included them. Nothing else: not slip notes,
 * not liveaboard status, not the lockbox access note, not HIN or USCG
 * numbers, and not the structured insurance fields.
 *
 * Documents, not status. A typed expiry date is a self-attested claim a
 * harbormaster can't verify — an owner whose cover has lapsed can type
 * whatever the marina requires. The certificate is the evidence. An
 * owner-entered expiry may show beside a document, but it is carried here
 * as `ownerEnteredExpiry` so no renderer can present it as ours.
 *
 * Nothing is hidden by being absent. An empty emergency contact is a
 * `null` the view must render as "No emergency contact on file", and a
 * document is one of three stated states — a harbormaster should never
 * have to guess whether a missing row is empty or withheld.
 *
 * SLIP NUMBER was added 2026-09-18 for the roster, whose first job is
 * finding one boat on a dock by name or slip. It is the marina's own
 * assignment, entered by the owner; no grant existed when it was added,
 * so no owner agreed to a set without it. Slip NOTES stay out.
 *
 * No storage path ever leaves this module. A document is a state; the
 * bytes are fetched through the documents route, which re-checks access.
 *
 * Pure, and free of Next-only imports, so tests import it directly.
 */

export type MarinaDocumentState =
  | { state: "on_file"; format: "pdf" | "image"; ownerEnteredExpiry: string | null }
  | { state: "missing" }
  | { state: "not_shared" };

export type MarinaGrant = {
  share_registration: boolean;
  share_insurance: boolean;
};

export type EmergencyContact = {
  name: string | null;
  phone: string | null;
  relationship: string | null;
};

export type MarinaView = {
  mxe_id: string;
  vessel_name: string;
  make: string;
  model: string;
  year: number;
  vessel_type: string | null;
  photo_url: string | null;
  slip: string | null;
  owner: { name: string | null; phone: string | null; email: string | null };
  /** null = nothing on file. Render the row saying so; never omit it. */
  emergency: EmergencyContact | null;
  registration: MarinaDocumentState;
  insurance: MarinaDocumentState;
};

/** The columns the projection reads, and only those. */
export type MarinaViewSource = {
  mxe_id: string;
  vessel_name: string;
  make: string;
  model: string;
  year: number;
  vessel_type: string | null;
  photo_url: string | null;
  slip_number: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  owner_email: string | null;
  emg_name: string | null;
  emg_phone: string | null;
  emg_relationship: string | null;
  doc_registration_url: string | null;
  doc_insurance_url: string | null;
  reg_expiry: string | null;
  ins_expiry: string | null;
};

function present(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function emergencyContactOf(v: Pick<MarinaViewSource, "emg_name" | "emg_phone" | "emg_relationship">): EmergencyContact | null {
  const contact = {
    name: present(v.emg_name),
    phone: present(v.emg_phone),
    relationship: present(v.emg_relationship),
  };
  return contact.name || contact.phone || contact.relationship ? contact : null;
}

/**
 * The viewer needs to know whether to frame a PDF or show an image. That
 * is derived here from the stored path's extension so the path itself
 * never has to leave this module.
 */
function formatOf(path: string): "pdf" | "image" {
  return path.toLowerCase().endsWith(".pdf") ? "pdf" : "image";
}

function documentState(shared: boolean, path: string | null, expiry: string | null): MarinaDocumentState {
  if (!shared) return { state: "not_shared" };
  const stored = present(path);
  if (!stored) return { state: "missing" };
  return { state: "on_file", format: formatOf(stored), ownerEnteredExpiry: present(expiry) };
}

export function buildMarinaView(v: MarinaViewSource, grant: MarinaGrant): MarinaView {
  return {
    mxe_id: v.mxe_id,
    vessel_name: v.vessel_name,
    make: v.make,
    model: v.model,
    year: v.year,
    vessel_type: v.vessel_type,
    photo_url: v.photo_url,
    slip: present(v.slip_number),
    owner: {
      name: present(v.owner_name),
      phone: present(v.owner_phone),
      email: present(v.owner_email),
    },
    emergency: emergencyContactOf(v),
    registration: documentState(grant.share_registration, v.doc_registration_url, v.reg_expiry),
    insurance: documentState(grant.share_insurance, v.doc_insurance_url, v.ins_expiry),
  };
}

/**
 * A dormant vessel (lapsed or locked): the roster row stays, the detail
 * view goes — except emergency contact. A marina's need to reach someone
 * is highest when the owner has disengaged, and gating a phone number
 * behind billing is wrong for a safety-adjacent product (spec §4.2).
 */
export type MarinaDormantView = { emergency: EmergencyContact | null };

export function buildMarinaDormantView(v: Pick<MarinaViewSource, "emg_name" | "emg_phone" | "emg_relationship">): MarinaDormantView {
  return { emergency: emergencyContactOf(v) };
}

// ─── The roster ───────────────────────────────────────────────────────────

/**
 * One line of the harbormaster's roster (/marina). Built for finding one
 * boat fast on a phone, and for the two prompts a harbormaster can act on
 * at the dock: no emergency contact on file, and no document to look at.
 * Those markers are the mechanism that gets owners to fill their records
 * in — asked by the person who runs their marina, not nagged by us.
 *
 * Dormant (lapsed or locked): the row stays so the boat can still be
 * found, marked paused, with the emergency-contact marker — the one detail
 * a marina keeps then (spec §4.2). Owner name and documents are withheld.
 */
export type RosterRow = {
  mxe_id: string;
  vessel_name: string;
  slip: string | null;
  owner_name: string | null;
  paused: boolean;
  hasEmergencyContact: boolean;
  /** No document the marina can open: none included, or none uploaded. Null while paused. */
  noDocuments: boolean | null;
};

export type RosterSource = Pick<
  MarinaViewSource,
  | "mxe_id"
  | "vessel_name"
  | "slip_number"
  | "owner_name"
  | "emg_name"
  | "emg_phone"
  | "emg_relationship"
  | "doc_registration_url"
  | "doc_insurance_url"
>;

export function buildRosterRow(v: RosterSource, grant: MarinaGrant, dormant: boolean): RosterRow {
  const emergency = emergencyContactOf(v);
  // A contact with no phone number can't be called: it doesn't count.
  const hasEmergencyContact = !!emergency?.phone;
  const viewable =
    (grant.share_registration && !!present(v.doc_registration_url)) || (grant.share_insurance && !!present(v.doc_insurance_url));
  return {
    mxe_id: v.mxe_id,
    vessel_name: v.vessel_name,
    slip: present(v.slip_number),
    owner_name: dormant ? null : present(v.owner_name),
    paused: dormant,
    hasEmergencyContact,
    noDocuments: dormant ? null : !viewable,
  };
}

function fold(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Search as a harbormaster types it: "b12", "B-12" and "b 12" all find
 * slip B12; "pola" finds Polaris. Vessel name and slip first (what they
 * know at the dock), MXE ID and owner name too because it costs nothing.
 */
export function matchesRosterQuery(row: RosterRow, query: string): boolean {
  const q = fold(query);
  if (!q) return true;
  return [row.vessel_name, row.slip, row.mxe_id, row.owner_name].some((field) => fold(field).includes(q));
}

/** "Blue Moon 2" before "Blue Moon 10", and slip B2 before B12. */
export function byName(a: RosterRow, b: RosterRow): number {
  return a.vessel_name.localeCompare(b.vessel_name, undefined, { numeric: true, sensitivity: "base" });
}

/** Exact slip matches first, then name matches, then the rest — alphabetical within each. */
export function rankRoster(rows: RosterRow[], query: string): RosterRow[] {
  const q = fold(query);
  const score = (r: RosterRow) => (q && fold(r.slip) === q ? 0 : q && fold(r.vessel_name).startsWith(q) ? 1 : 2);
  return rows
    .filter((r) => matchesRosterQuery(r, query))
    .sort((a, b) => score(a) - score(b) || byName(a, b));
}
