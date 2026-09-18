/**
 * What a marina sees. The ONE definition — docs/moxie_digital_marina_access_spec.md §2.2.
 *
 * Owner contact, emergency contact, and the registration and insurance
 * DOCUMENTS where the owner included them. Nothing else: not slip notes,
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
 * No storage path ever leaves this module. A document is a state; the
 * bytes are fetched through the documents route, which re-checks access.
 *
 * Pure, and free of Next-only imports, so tests import it directly.
 */

export type MarinaDocumentState =
  | { state: "on_file"; ownerEnteredExpiry: string | null }
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

function documentState(shared: boolean, path: string | null, expiry: string | null): MarinaDocumentState {
  if (!shared) return { state: "not_shared" };
  if (!present(path)) return { state: "missing" };
  return { state: "on_file", ownerEnteredExpiry: present(expiry) };
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
