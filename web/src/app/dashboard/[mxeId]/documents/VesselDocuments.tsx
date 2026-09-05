import { SaveOfflineControl } from "@/components/pwa/SaveOfflineControl";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { DocumentsEdit } from "@/components/vessel-edit/DocumentsEdit";
import { isDocumentLocked, type DocumentSlot } from "@/lib/vessel-transfer";
import type { OfflineDocType } from "@/lib/offline-vessel-store";
import type { VesselDocumentMeta } from "@/lib/document-metadata";
import { getDormantInfo } from "@/lib/vessel-dormancy";

export type DocumentsVessel = {
  mxe_id: string;
  vessel_name: string;
  make: string | null;
  model: string | null;
  year: number | null;
  hin: string | null;
  reg_state: string | null;
  reg_number: string | null;
  reg_expiry: string | null;
  ins_expiry: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  emg_name: string | null;
  emg_phone: string | null;
  photo_url: string | null;
  doc_registration_url: string | null;
  doc_insurance_url: string | null;
  doc_boater_card_url: string | null;
  ca_boater_card: boolean | null;
  qr_status: string | null;
  lifecycle_status: string | null;
  dormant_cause: string | null;
};

/**
 * The documents half of what used to be the Manage page, given a page of
 * its own. On Manage these sat between Registration and Insurance as a
 * small unlabelled block, which put the one thing an owner might need
 * with no signal — the papers themselves — behind a scroll through six
 * sections of fields they'd rarely touch.
 *
 * Everything here is lifted intact: SaveOfflineControl and DocumentsEdit
 * are unchanged, and InstallPrompt is the existing component mounted a
 * third time (alongside /dashboard and the QR page) rather than new
 * install copy written for this page.
 */
export function VesselDocuments({
  vessel,
  subscriptionTier,
  documentMeta,
  singleVessel,
}: {
  vessel: DocumentsVessel;
  subscriptionTier: "basic" | "full";
  documentMeta: VesselDocumentMeta;
  /** True when this is the owner's only active vessel — drives the automatic-caching default (build spec §8 decision 2). */
  singleVessel: boolean;
}) {
  const dormant = getDormantInfo({
    lifecycle_status: vessel.lifecycle_status,
    dormant_cause: vessel.dormant_cause,
  });
  const needsActivation = vessel.qr_status != null && vessel.qr_status !== "active";

  // Which documents "save for offline" should fetch — same Basic-tier
  // lock DocumentsEdit.tsx enforces (registration counted first,
  // insurance second, boater_card always exempt), so offline access
  // never covers a document that isn't viewable online either (build
  // spec §6). The API route re-checks this itself server-side; this is
  // just what the client asks for.
  const docSlots: DocumentSlot[] = [
    { docType: "registration", url: vessel.doc_registration_url },
    { docType: "insurance", url: vessel.doc_insurance_url },
  ];
  const availableDocs: OfflineDocType[] = [
    ...docSlots
      .filter((slot, i) => slot.url && !isDocumentLocked(docSlots, i, subscriptionTier))
      .map((slot) => slot.docType as OfflineDocType),
    ...(vessel.doc_boater_card_url ? (["boater_card"] as OfflineDocType[]) : []),
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
      <section className="mt-6 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
        <p className="font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
          Registration and proof of insurance are the two things you get asked for in the exact places least likely
          to have a signal — a fuel dock, a boat ramp, an anchorage, the wrong side of a harbour wall.
        </p>
        <p className="mt-3 font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
          Saving this vessel for offline keeps a copy of each document on this device, so it opens whether or not
          Moxie can reach the network. Install Moxie to your home screen and it opens like any other app.
        </p>
      </section>

      {/*
        Same dormant lock the Manage page applies to its editable block —
        moving these controls to their own page must not move them out
        from behind it. Document access is suspended while dormant
        (dormant identity spec §3), and that has to hold wherever the
        documents are rendered.
      */}
      <div className={dormant.isDormant ? "pointer-events-none opacity-60" : undefined} aria-disabled={dormant.isDormant}>
        <div className="mt-6">
          <SaveOfflineControl
            identity={{
              mxeId: vessel.mxe_id,
              vesselName: vessel.vessel_name,
              make: vessel.make,
              model: vessel.model,
              year: vessel.year,
              hin: vessel.hin,
              regState: vessel.reg_state,
              regNumber: vessel.reg_number,
              ownerName: vessel.owner_name,
              ownerPhone: vessel.owner_phone,
              emgName: vessel.emg_name,
              emgPhone: vessel.emg_phone,
              photoUrl: vessel.photo_url,
              availableDocs,
              docVersions,
            }}
            autoSave={singleVessel}
            disabled={dormant.isDormant || needsActivation}
          />
        </div>

        <h2
          id="documents"
          className="mt-10 scroll-mt-20 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.14em] text-[var(--text3)]"
        >
          Documents on file
        </h2>
        <DocumentsEdit
          mxeId={vessel.mxe_id}
          doc_registration_url={vessel.doc_registration_url}
          doc_insurance_url={vessel.doc_insurance_url}
          doc_boater_card_url={vessel.doc_boater_card_url}
          ca_boater_card={vessel.ca_boater_card}
          subscriptionTier={subscriptionTier}
          documentMeta={documentMeta}
          regExpiry={vessel.reg_expiry}
          insExpiry={vessel.ins_expiry}
        />
      </div>

      <div className="mt-10">
        <InstallPrompt />
      </div>
    </>
  );
}
