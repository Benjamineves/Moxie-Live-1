"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { uploadVesselDocument, type DocType } from "@/lib/vessel-uploads";
import {
  updateVesselDocument,
  updateVesselOwnerFields,
  updateVesselIntrinsicFields,
  checkStorageCapacity,
} from "@/lib/owner-actions";
import { ConfirmDialog, FieldDiffList } from "@/components/ConfirmDialog";
import { getExpiryStatus, type ExpiryStatus } from "@/lib/document-expiry";
import { isDocumentLocked, type DocumentSlot } from "@/lib/vessel-transfer";
import { getOfflineMeta, openOfflineDocument } from "@/lib/offline-vessel-store";
import { vesselDocumentUrl } from "@/lib/document-url";
import { useIsOnline } from "@/lib/use-is-online";
import type { DocumentFileMeta, VesselDocumentMeta } from "@/lib/document-metadata";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

function formatUploadedAt(iso: string) {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * The line under each document's label. Deliberately never derived from
 * the stored path: uploadVesselDocument writes to a deterministic
 * {userId}/{mxeId}/registration.pdf, so its basename is identical for
 * every vessel in the system and reads as a filename while carrying no
 * information at all. What's shown instead is the original upload name
 * (where we have one — recorded only since
 * 20260918_document_original_filenames.sql) plus the date and size of
 * the actual stored bytes, read from Storage.
 *
 * "On file" is the floor: a document uploaded before filenames were
 * recorded, whose Storage listing also failed, still gets an honest
 * label rather than a fabricated one.
 */
function describeDocument(meta: DocumentFileMeta | undefined): string {
  const parts: string[] = [];
  if (meta?.fileName) parts.push(meta.fileName);
  if (meta?.uploadedAt) {
    const date = formatUploadedAt(meta.uploadedAt);
    if (date) parts.push(`Uploaded ${date}`);
  }
  if (typeof meta?.sizeBytes === "number") parts.push(formatBytes(meta.sizeBytes));
  return parts.length > 0 ? parts.join(" · ") : "On file";
}

const ACTION_CLASS =
  "shrink-0 rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--navy)] transition hover:bg-[var(--gold-dim)]";

/** Uploads are constrained to image/* or application/pdf at the file input, so the stored extension is one or the other. */
function isPdf(path: string) {
  return path.split(".").pop()?.toLowerCase() === "pdf";
}

/**
 * Expiry status alongside (not instead of) the upload date/size line.
 * Registration reads reg_expiry, insurance reads ins_expiry — both
 * already existed and were owner-editable, just disconnected from the
 * documents they describe. The boater card gets none: a CA Boater Card
 * is valid for the holder's lifetime, the same reason it's exempt from
 * the Basic document limit.
 *
 * Colour is a second signal, never the only one. Each label reads
 * unambiguously on its own — "Expired Mar 2026" / "Expires in 23 days" /
 * "Expires Mar 2027" / "No expiry date set" — so the state survives
 * greyscale, colour-blindness, and being read aloud.
 */
function ExpiryBadge({ status }: { status: ExpiryStatus }) {
  const tone: Record<ExpiryStatus["state"], string> = {
    current: "border-[var(--green-fg)] bg-[var(--green-bg)] text-[var(--green-fg)]",
    expiring: "border-[var(--gold-line)] bg-[var(--gold-dim)] text-[var(--navy)]",
    expired: "border-[var(--red-fg)] bg-[var(--red-bg)] text-[var(--red-fg)]",
    none: "border-[var(--divider)] bg-[var(--gray-bg)] text-[var(--gray-fg)]",
  };
  return (
    <span
      className={`mt-1 inline-flex rounded-full border px-2 py-0.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.08em] ${tone[status.state]}`}
    >
      {status.label}
    </span>
  );
}

type ExpiryField = "reg_expiry" | "ins_expiry" | "fishing_license_expiry";

const EXPIRY_FIELD_LABELS: Record<ExpiryField, string> = {
  reg_expiry: "Registration expiry",
  ins_expiry: "Insurance expiry",
  fishing_license_expiry: "Fishing license expiry",
};

/**
 * Inline expiry entry, right in the row. Auto-opens after an upload that
 * left the date null (the document is on screen and the date is printed
 * on it — a few seconds of work), and is openable by hand any other
 * time. Always skippable, and never in the upload's way: the file is
 * already saved by the time this appears.
 *
 * reg_expiry is a vessel-intrinsic field, so it goes through
 * updateVesselIntrinsicFields behind the same ConfirmDialog step
 * RegistrationEdit uses, rather than around it. ins_expiry is an owner
 * field and saves directly, matching InsuranceEdit.
 */
function ExpiryEditor({
  mxeId,
  field,
  current,
  onClose,
}: {
  mxeId: string;
  field: ExpiryField;
  current: string | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const [value, setValue] = useState(current ?? "");
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isIntrinsic = field === "reg_expiry";
  const label = EXPIRY_FIELD_LABELS[field];

  async function save() {
    setPending(true);
    setError(null);
    try {
      const next = value.trim() || null;
      // reg_expiry is the only vessel-intrinsic one. ins_expiry and
      // fishing_license_expiry both describe things the owner holds, not
      // the hull, so they save directly with no confirm step.
      const result = isIntrinsic
        ? await updateVesselIntrinsicFields(mxeId, { reg_expiry: next })
        : await updateVesselOwnerFields(
            mxeId,
            field === "ins_expiry" ? { ins_expiry: next } : { fishing_license_expiry: next },
          );
      if (result.error) throw new Error(result.error);
      onClose();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
      setConfirming(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--divider)] bg-[var(--cream)] px-3 py-2.5">
      <label className="block font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--navy)]">
        {label}
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="mt-1 block w-full rounded-md border border-[var(--divider)] bg-[var(--white)] px-2.5 py-1.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
        />
      </label>
      <p className="mt-1.5 font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
        {field === "fishing_license_expiry"
          ? // Said explicitly because the intuition is wrong: a CA sport
            // fishing license runs 365 days from the day it was bought,
            // so it does not end on Dec 31 and cannot be guessed from
            // the year. Nothing here defaults or derives it.
            "Read it off the license itself — a CA license runs 365 days from purchase, so it rarely lands on a year-end."
          : "It's printed on the document itself. Adding it shows this document's status at a glance here."}
      </p>
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          disabled={pending || !value.trim()}
          onClick={() => (isIntrinsic ? setConfirming(true) : void save())}
          className="rounded-md bg-[var(--navy)] px-3 py-1.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gold)] disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save date"}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text2)] underline"
        >
          Skip
        </button>
      </div>
      {error ? <p className="mt-1.5 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p> : null}
      {isIntrinsic ? (
        <ConfirmDialog
          open={confirming}
          title="Update registration expiry?"
          pending={pending}
          onCancel={() => setConfirming(false)}
          onConfirm={() => void save()}
        >
          <FieldDiffList diff={[{ label: "Reg. expiry", from: current ?? "", to: value.trim() }]} />
        </ConfirmDialog>
      ) : null}
    </div>
  );
}

type ViewerTarget = { docType: DocType; label: string; path: string; meta: DocumentFileMeta | undefined };

/**
 * In-app document viewer (moxie_digital_pwa_spec.md §3b).
 *
 * Replaces what used to be a plain link to the document route. Handing
 * the file to the platform's native viewer meant leaving the app, and
 * exit behavior ranged from inconsistent to closing the whole app —
 * across iPad PWA, desktop Safari, Android PWA and the desktop app. Same
 * no-back-button problem as the public-profile header: standalone mode
 * has nothing to come back with, so viewing has to stay in-app behind an
 * explicit close control.
 *
 * The URL is resolved here rather than up front — the live route while
 * online, a blob URL from the offline cache when not, which is the same
 * resolution the row's own availability check uses. Resolving on open
 * (rather than for every row on mount) is what makes revoking on close
 * correct: the blob exists exactly as long as the modal showing it does.
 */
function DocumentViewerModal({
  mxeId,
  target,
  isOnline,
  onClose,
}: {
  mxeId: string;
  target: ViewerTarget;
  isOnline: boolean;
  onClose: () => void;
}) {
  const [href, setHref] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let created: string | null = null;

    (async () => {
      // Deliberate microtask deferral — this repo's lint config errors on
      // a setState reachable synchronously from an effect body.
      await Promise.resolve();
      if (cancelled) return;

      if (isOnline) {
        // Tokenized by upload time, so replacing a document produces a
        // URL the service worker's cache-first rule has never seen (see
        // lib/document-url.ts). Same helper the offline save and read
        // use — they have to agree exactly or the cached copy becomes
        // unreachable rather than merely stale.
        setHref(vesselDocumentUrl(mxeId, target.docType, target.meta?.uploadedAt));
        return;
      }

      const blob = await openOfflineDocument(mxeId, target.docType);
      if (cancelled) {
        // Closed mid-resolve — the blob still has to be released, since
        // the cleanup below already ran without knowing about it.
        if (blob) URL.revokeObjectURL(blob);
        return;
      }
      if (!blob) {
        setUnavailable(true);
        return;
      }
      created = blob;
      setHref(blob);
    })();

    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [mxeId, target.docType, target.meta?.uploadedAt, isOnline]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${target.label} — document viewer`}
      // Backdrop click closes; the panel below stops the event reaching
      // here, so a click inside the document never dismisses it.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-[rgba(13,31,53,0.6)] p-4"
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[var(--white)] shadow-xl">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--divider)] px-5 py-4">
          <div className="min-w-0">
            <p className="font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--navy)]">{target.label}</p>
            <p className="mt-0.5 truncate font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
              {describeDocument(target.meta)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close document viewer"
            className="shrink-0 rounded-md border border-[var(--divider)] px-2.5 py-1.5 font-[family-name:var(--font-dm)] text-sm leading-none text-[var(--text2)] transition hover:bg-[var(--cream)]"
          >
            ✕
          </button>
        </div>

        <div className="flex h-[70vh] items-center justify-center overflow-auto bg-[var(--cream2)]">
          {unavailable ? (
            <p className="px-6 text-center font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
              This document isn&apos;t saved on this device, and there&apos;s no connection to fetch it. Reconnect, or
              save this vessel for offline access while you have signal.
            </p>
          ) : !href ? (
            <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text3)]">Opening…</p>
          ) : isPdf(target.path) ? (
            <iframe src={href} title={`${target.label} document`} className="h-full w-full border-0" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={href} alt={target.label} className="max-h-full max-w-full object-contain" />
          )}
        </div>

        {href ? (
          <div className="border-t border-[var(--divider)] px-5 py-3">
            {/*
              The one deliberate way out of the app, opt-in rather than
              default: iOS Safari renders only the first page of an
              iframed PDF, so a multi-page registration needs a real
              viewer to be read in full. Useful for images too — the
              native viewer is where zooming actually works.
            */}
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline"
            >
              Open full document ↗
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * One row per document slot — registration, insurance, boater card.
 * Previously two near-identical copies of this markup (the boater card's
 * only real difference is the ca_boater_card checkbox below it, which
 * comes in as `footer`), which is how the two drifted apart in the first
 * place.
 */
function DocumentFileRow({
  mxeId,
  docType,
  label,
  url,
  meta,
  canView,
  onView,
  expiryField,
  expiryValue,
  expiryExempt = false,
  footer,
}: {
  mxeId: string;
  docType: DocType;
  label: string;
  url: string | null;
  meta: DocumentFileMeta | undefined;
  canView: boolean;
  onView: (target: ViewerTarget) => void;
  /** Set only for documents that can carry a date; the boater card never expires at all. */
  expiryField?: ExpiryField;
  expiryValue?: string | null;
  /**
   * This particular document genuinely has no expiry — a CDFW Lifetime
   * Sport Fishing License. Distinct from having no date on file: there
   * is nothing missing, so no status is shown and no date is asked for.
   */
  expiryExempt?: boolean;
  footer?: ReactNode;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editingExpiry, setEditingExpiry] = useState(false);

  async function onFileSelected(files: FileList | null) {
    const file = files?.[0];
    if (!file) return;

    const isAllowed = file.type.startsWith("image/") || file.type === "application/pdf";
    if (!isAllowed) {
      setError("Document must be a PDF or image.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError("Max upload size is 10MB.");
      return;
    }

    setError(null);
    setUploading(true);
    try {
      const capacity = await checkStorageCapacity(file.size);
      if (!capacity.ok) throw new Error(capacity.error);
      const { path, fileName } = await uploadVesselDocument(file, mxeId, docType);
      const result = await updateVesselDocument(mxeId, docType, path, fileName);
      if (result.error) throw new Error(result.error);
      // The upload is already committed by this point — the prompt below
      // never gates it, and skipping the date leaves the file exactly as
      // saved.
      if (expiryField && !expiryValue && !expiryExempt) setEditingExpiry(true);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="border-b border-[var(--divider)] py-3 last:border-0">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{label}</p>
          <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
            {url ? describeDocument(meta) : "No file uploaded"}
          </p>
          {url && expiryField && expiryExempt ? (
            <span className="mt-1 inline-flex rounded-full border border-[var(--green-fg)] bg-[var(--green-bg)] px-2 py-0.5 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--green-fg)]">
              Lifetime — never expires
            </span>
          ) : null}
          {url && expiryField && !expiryExempt ? (
            <div className="flex flex-wrap items-center gap-2">
              <ExpiryBadge status={getExpiryStatus(expiryValue)} />
              {!expiryValue && !editingExpiry ? (
                <button
                  type="button"
                  onClick={() => setEditingExpiry(true)}
                  className="mt-1 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--navy)] underline"
                >
                  Add date
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {url && canView ? (
            <button type="button" onClick={() => onView({ docType, label, path: url, meta })} className={ACTION_CLASS}>
              View
            </button>
          ) : null}
          {url && !canView ? (
            <span
              aria-disabled="true"
              className="shrink-0 rounded-md border border-[var(--divider)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--text3)]"
            >
              View — needs a connection
            </span>
          ) : null}
          <label className={`${ACTION_CLASS} cursor-pointer`}>
            {uploading ? "Uploading…" : url ? "Replace" : "Add"}
            <input
              type="file"
              accept="application/pdf,image/*"
              disabled={uploading}
              onChange={(e) => onFileSelected(e.target.files)}
              className="hidden"
            />
          </label>
        </div>
      </div>
      {url && expiryField && !expiryExempt && editingExpiry ? (
        <ExpiryEditor
          mxeId={mxeId}
          field={expiryField}
          current={expiryValue ?? null}
          onClose={() => setEditingExpiry(false)}
        />
      ) : null}
      {footer}
      {error ? <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p> : null}
    </div>
  );
}

/**
 * The boater card as one unit: the uploaded card file (the shared
 * DocumentFileRow above) plus the ca_boater_card checkbox, which used to
 * live disconnected from this in SafetyEdit's physical-equipment
 * checklist — life jackets, fire extinguisher, flares, sound device. A
 * boater card is a personal operator credential, not something bolted to
 * the boat, which is exactly why both the file and the checkbox are
 * owner-specific: they stay with the seller on ownership transfer
 * (complete_ownership_transfer clears both), and neither counts toward
 * the Basic document limit.
 *
 * The checkbox saves immediately on toggle, matching this component's
 * existing per-row auto-save behavior (file uploads here have never used
 * an edit/cancel/save step either) rather than introducing a different
 * interaction pattern for just this one field.
 */
function BoaterCardRow({
  mxeId,
  url,
  hasCard,
  meta,
  canView,
  onView,
}: {
  mxeId: string;
  url: string | null;
  hasCard: boolean | null | undefined;
  meta: DocumentFileMeta | undefined;
  canView: boolean;
  onView: (target: ViewerTarget) => void;
}) {
  const router = useRouter();
  const [savingCard, setSavingCard] = useState(false);
  const [cardError, setCardError] = useState<string | null>(null);

  async function onToggleHasCard(checked: boolean) {
    setCardError(null);
    setSavingCard(true);
    try {
      const result = await updateVesselOwnerFields(mxeId, { ca_boater_card: checked });
      if (result.error) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setCardError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSavingCard(false);
    }
  }

  return (
    <DocumentFileRow
      mxeId={mxeId}
      docType="boater_card"
      label="Boater Card"
      url={url}
      meta={meta}
      canView={canView}
      onView={onView}
      footer={
        <>
          <label className="mt-2 flex items-center gap-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
            <input
              type="checkbox"
              checked={!!hasCard}
              disabled={savingCard}
              onChange={(e) => onToggleHasCard(e.target.checked)}
            />
            {savingCard ? "Saving…" : "Operator has a CA boater card on file"}
          </label>
          {cardError ? (
            <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{cardError}</p>
          ) : null}
        </>
      }
    />
  );
}

/**
 * The fishing license as one unit: the uploaded file plus the lifetime
 * checkbox, the same shape BoaterCardRow uses — and for the same reason,
 * since both are credentials the OPERATOR holds rather than equipment
 * bolted to the boat.
 *
 * What makes it its own component instead of another slot: CDFW sells
 * both an annual license, which expires 365 days after the day it was
 * bought, and Lifetime Sport Fishing License packages, which genuinely
 * never expire. So a single row has to express three different states —
 * a date, no date yet, and no date will ever exist — where every other
 * document here only has the first two. The checkbox is what
 * distinguishes "the owner hasn't told us yet" from "there is nothing
 * to tell", and without it a lifetime holder would be nagged forever for
 * a date that does not exist.
 *
 * Tier-gated like registration and insurance, unlike the boater card.
 * The boater card's exemption has never been about whose credential it
 * is — it's included on every plan by policy.
 *
 * Toggling saves immediately, matching every other control in this
 * component rather than introducing an edit/cancel/save step for one
 * checkbox.
 */
function FishingLicenseRow({
  mxeId,
  url,
  meta,
  canView,
  onView,
  expiry,
  lifetime,
}: {
  mxeId: string;
  url: string | null;
  meta: DocumentFileMeta | undefined;
  canView: boolean;
  onView: (target: ViewerTarget) => void;
  expiry: string | null | undefined;
  lifetime: boolean | null | undefined;
}) {
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onToggleLifetime(checked: boolean) {
    setError(null);
    setSaving(true);
    try {
      // The date itself is deliberately left alone when switching to
      // lifetime — if the owner unticks it again, whatever they had
      // entered is still there rather than silently destroyed.
      const result = await updateVesselOwnerFields(mxeId, { fishing_license_lifetime: checked });
      if (result.error) throw new Error(result.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <DocumentFileRow
      mxeId={mxeId}
      docType="fishing_license"
      label="Fishing License"
      url={url}
      meta={meta}
      canView={canView}
      onView={onView}
      expiryField="fishing_license_expiry"
      expiryValue={expiry}
      expiryExempt={!!lifetime}
      footer={
        url ? (
          <>
            <label className="mt-2 flex items-center gap-2 font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
              <input
                type="checkbox"
                checked={!!lifetime}
                disabled={saving}
                onChange={(e) => onToggleLifetime(e.target.checked)}
              />
              {saving ? "Saving…" : "Lifetime license — no expiry date"}
            </label>
            {error ? (
              <p className="mt-1 font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</p>
            ) : null}
          </>
        ) : null
      }
    />
  );
}

/** Locked row — visible, never hidden, never deleted, just not openable. No View: the proxy route 403s a locked document server-side too. */
function LockedDocumentRow({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-[var(--divider)] py-3 last:border-0 opacity-70">
      <div>
        <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">{label}</p>
        <p className="mt-0.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text3)]">
          On file, locked on Basic
        </p>
      </div>
      <Link
        href="/dashboard/upgrade"
        className="shrink-0 rounded-md border border-[var(--gold-line)] px-3 py-2 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--gold-deep)] transition hover:bg-[var(--gold-dim)]"
      >
        🔒 Unlock with Full Access
      </Link>
    </div>
  );
}

/**
 * Registration/insurance/boater-card files replace in place — no version
 * history, overwriting just replaces what's there (build spec).
 *
 * Basic-tier document locking (BASIC_DOCUMENT_LIMIT, lib/vessel-transfer.ts):
 * a document beyond the limit is never hidden or deleted — it stays on
 * file, just not openable until upgrading. Boater card is always
 * exempt (personal credential, not counted either way) and never
 * transfers on ownership change, same reasoning.
 */
export function DocumentsEdit({
  mxeId,
  doc_registration_url,
  doc_insurance_url,
  doc_boater_card_url,
  doc_fishing_license_url,
  ca_boater_card,
  fishingLicenseExpiry,
  fishingLicenseLifetime,
  subscriptionTier,
  documentMeta = {},
  regExpiry,
  insExpiry,
}: {
  mxeId: string;
  doc_registration_url: string | null | undefined;
  doc_insurance_url: string | null | undefined;
  doc_boater_card_url: string | null | undefined;
  doc_fishing_license_url: string | null | undefined;
  ca_boater_card: boolean | null | undefined;
  /** 20260919_fishing_license_document.sql. Never defaulted or derived — a CA license runs 365 days from purchase. */
  fishingLicenseExpiry?: string | null;
  /** True for a CDFW Lifetime Sport Fishing License, which never expires. */
  fishingLicenseLifetime?: boolean | null;
  subscriptionTier: "basic" | "full";
  /** Upload date/size/original filename per document, resolved server-side (lib/document-metadata.ts). */
  documentMeta?: VesselDocumentMeta;
  /** Existing owner-editable columns, surfaced here against the documents they describe. No new schema. */
  regExpiry?: string | null;
  insExpiry?: string | null;
}) {
  const isOnline = useIsOnline();
  const [viewing, setViewing] = useState<ViewerTarget | null>(null);

  // Which documents this vessel has cached, purely to decide whether a
  // row can offer View while offline. Read from the offline metadata
  // rather than by opening the caches: getOfflineMeta is a synchronous
  // localStorage read, and openOfflineDocument would create an empty
  // Cache Storage entry for a vessel that was never saved. The actual
  // bytes are resolved later, in the viewer, only for the one document
  // being opened.
  const [cachedDocs, setCachedDocs] = useState<DocType[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Deliberate microtask deferral — this repo's lint config errors on
      // a setState reachable synchronously from an effect body. Same
      // pattern as SaveOfflineControl.tsx and /offline-vessel.
      await Promise.resolve();
      if (cancelled) return;
      setCachedDocs(getOfflineMeta(mxeId)?.docs ?? []);
    })();
    return () => {
      cancelled = true;
    };
  }, [mxeId]);

  // Online, every populated row can open (the route streams the live
  // bytes, which is also the authoritative copy right after a Replace).
  // Offline, only what "save for offline" already cached.
  const canView = (docType: DocType) => isOnline || cachedDocs.includes(docType);

  // Fixed order — registration counts first, insurance second, fishing
  // license third — so which document (if any) shows locked stays stable
  // across reloads. This must stay identical to the slots array in
  // api/vessels/[mxeId]/documents/[docType]/route.ts, or the UI and the
  // route would disagree about which document is locked.
  //
  // Lock order is not render order: the fishing license is displayed
  // below the boater card (which is exempt from counting entirely and so
  // isn't in here at all), while still being counted last.
  const slots: DocumentSlot[] = [
    { docType: "registration", url: doc_registration_url ?? null },
    { docType: "insurance", url: doc_insurance_url ?? null },
    { docType: "fishing_license", url: doc_fishing_license_url ?? null },
  ];
  const labels: Record<DocumentSlot["docType"], string> = {
    registration: "Registration",
    insurance: "Insurance card",
    fishing_license: "Fishing License",
  };
  const fishingLicenseIndex = slots.findIndex((s) => s.docType === "fishing_license");
  const fishingLicenseLocked = isDocumentLocked(slots, fishingLicenseIndex, subscriptionTier);

  return (
    <div className="mt-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      {slots
        .filter((slot) => slot.docType !== "fishing_license")
        .map((slot, i) =>
        isDocumentLocked(slots, i, subscriptionTier) ? (
          <LockedDocumentRow key={slot.docType} label={labels[slot.docType]} />
        ) : (
          <DocumentFileRow
            key={slot.docType}
            mxeId={mxeId}
            docType={slot.docType}
            label={labels[slot.docType]}
            url={slot.url}
            meta={documentMeta[slot.docType]}
            canView={canView(slot.docType)}
            onView={setViewing}
            expiryField={slot.docType === "registration" ? "reg_expiry" : "ins_expiry"}
            expiryValue={slot.docType === "registration" ? regExpiry : insExpiry}
          />
        ),
      )}
      <BoaterCardRow
        mxeId={mxeId}
        url={doc_boater_card_url ?? null}
        hasCard={ca_boater_card}
        meta={documentMeta.boater_card}
        canView={canView("boater_card")}
        onView={setViewing}
      />
      {fishingLicenseLocked ? (
        <LockedDocumentRow label={labels.fishing_license} />
      ) : (
        <FishingLicenseRow
          mxeId={mxeId}
          url={doc_fishing_license_url ?? null}
          meta={documentMeta.fishing_license}
          canView={canView("fishing_license")}
          onView={setViewing}
          expiry={fishingLicenseExpiry}
          lifetime={fishingLicenseLifetime}
        />
      )}
      {viewing ? (
        <DocumentViewerModal
          mxeId={mxeId}
          target={viewing}
          isOnline={isOnline}
          onClose={() => setViewing(null)}
        />
      ) : null}
    </div>
  );
}
