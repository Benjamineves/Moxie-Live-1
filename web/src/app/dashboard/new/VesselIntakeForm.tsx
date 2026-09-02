"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { StorageTypePicker, isMarinaGroup, storageTypeLabel } from "@/components/StorageTypePicker";
import { vesselTypes } from "@/lib/vessel-types";
import { US_STATES } from "@/lib/us-states";
import { createVessel, previewNextMxeId, type StorageType } from "./actions";

type FormState = {
  vessel_name: string;
  vessel_type: string;
  make: string;
  model: string;
  year: string;
  length_ft: string;
  draft_ft: string;
  public_notes: string;
  storage_type: StorageType;
  storage_state: string;
  storage_city: string;
  marina_name: string;
  slip_number: string;
  marina_phone: string;
  is_liveaboard: boolean;
  slip_notes: string;
  storage_description: string;
  photo_url: string;
  doc_registration_url: string;
  doc_insurance_url: string;
};

type UploadProgress = { photo: number; registration: number; insurance: number };

export function VesselIntakeForm() {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [step, setStep] = useState(1);
  const [pending, startTransition] = useTransition();
  const [form, setForm] = useState<FormState>({
    vessel_name: "",
    vessel_type: "Sailboat",
    make: "",
    model: "",
    year: "",
    length_ft: "",
    draft_ft: "",
    public_notes: "",
    storage_type: "marina",
    storage_state: "",
    storage_city: "",
    marina_name: "",
    slip_number: "",
    marina_phone: "",
    is_liveaboard: false,
    slip_notes: "",
    storage_description: "",
    photo_url: "",
    doc_registration_url: "",
    doc_insurance_url: "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [generalError, setGeneralError] = useState<string | null>(null);
  const [capReached, setCapReached] = useState(false);
  const [mxeId, setMxeId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress>({
    photo: 0,
    registration: 0,
    insurance: 0,
  });

  const canProceedStep1 = useMemo(() => {
    const yearNum = Number.parseInt(form.year, 10);
    return (
      !!form.vessel_name.trim() &&
      !!form.vessel_type &&
      !!form.make.trim() &&
      !!form.model.trim() &&
      Number.isFinite(yearNum) &&
      yearNum >= 1900 &&
      yearNum <= 2030
    );
  }, [form]);

  function onBlur(name: keyof FormState) {
    if (name === "vessel_name" && !form.vessel_name.trim()) setErrors((p) => ({ ...p, vessel_name: "Required" }));
    if (name === "make" && !form.make.trim()) setErrors((p) => ({ ...p, make: "Required" }));
    if (name === "model" && !form.model.trim()) setErrors((p) => ({ ...p, model: "Required" }));
    if (name === "year") {
      const yearNum = Number.parseInt(form.year, 10);
      if (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2030) {
        setErrors((p) => ({ ...p, year: "Use a year from 1900–2030" }));
      }
    }
  }

  async function ensureMxeId() {
    if (mxeId) return mxeId;
    const result = await previewNextMxeId();
    if (!result.mxeId) throw new Error(result.error ?? "Could not reserve MXE ID.");
    setMxeId(result.mxeId);
    return result.mxeId;
  }

  function extFor(file: File) {
    const direct = file.name.split(".").pop()?.toLowerCase();
    if (direct) return direct;
    if (file.type.includes("png")) return "png";
    if (file.type.includes("jpeg")) return "jpg";
    if (file.type.includes("pdf")) return "pdf";
    return "bin";
  }

  function simulateProgress(kind: keyof UploadProgress) {
    setUploadProgress((prev) => ({ ...prev, [kind]: 5 }));
    const timer = window.setInterval(() => {
      setUploadProgress((prev) => ({ ...prev, [kind]: Math.min(prev[kind] + 12, 80) }));
    }, 120);
    return () => window.clearInterval(timer);
  }

  async function uploadFile(file: File, kind: keyof UploadProgress, key: keyof FormState, pathBase: string) {
    if (!supabase) throw new Error("Missing Supabase browser configuration.");
    const cleanup = simulateProgress(kind);
    try {
      const mxe = await ensureMxeId();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) throw new Error("Please sign in again before uploading.");
      const ext = extFor(file);
      const path = `${user.id}/${mxe}/${pathBase}.${ext}`;
      const bucket = key === "photo_url" ? "vessel-photos" : "vessel-docs";

      const { error } = await supabase.storage.from(bucket).upload(path, file, {
        upsert: true,
        contentType: file.type,
      });
      if (error) throw error;

      let stored = path;
      if (bucket === "vessel-photos") {
        const { data } = supabase.storage.from(bucket).getPublicUrl(path);
        stored = data.publicUrl;
      }
      setForm((prev) => ({ ...prev, [key]: stored }));
      setUploadProgress((prev) => ({ ...prev, [kind]: 100 }));
    } finally {
      cleanup();
    }
  }

  async function onUpload(files: FileList | null, kind: keyof UploadProgress, key: keyof FormState, pathBase: string) {
    if (!files?.[0]) return;
    const file = files[0];
    const isPhoto = key === "photo_url";
    const isAllowedDoc = file.type.startsWith("image/") || file.type === "application/pdf";
    if (file.size > 10 * 1024 * 1024) {
      setGeneralError("Max upload size is 10MB.");
      return;
    }
    if ((isPhoto && !file.type.startsWith("image/")) || (!isPhoto && !isAllowedDoc)) {
      setGeneralError(isPhoto ? "Photo must be an image file." : "Document must be a PDF or image.");
      return;
    }

    setGeneralError(null);
    setUploading(true);
    try {
      await uploadFile(file, kind, key, pathBase);
    } catch (error) {
      setGeneralError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function stepForward() {
    if (step === 1) {
      if (!canProceedStep1) {
        setGeneralError("Fill all required basics before continuing.");
        return;
      }
      setGeneralError(null);
      setStep(2);
      return;
    }
    if (step === 2) {
      // Storage state is the only new blocker on this step — city and
      // the marina fields stay optional, so this doesn't turn the
      // location step into a wall of required inputs.
      if (!form.storage_state) {
        setErrors((p) => ({ ...p, storage_state: "Required" }));
        setGeneralError("Select the state where your vessel is stored.");
        return;
      }
      setGeneralError(null);
      setStep(3);
      return;
    }
    if (step === 3) {
      startTransition(async () => {
        try {
          await ensureMxeId();
          setStep(4);
        } catch (error) {
          setGeneralError(error instanceof Error ? error.message : "Could not prepare review step.");
        }
      });
    }
  }

  function onSubmit() {
    setGeneralError(null);
    setCapReached(false);
    startTransition(async () => {
      const result = await createVessel(
        {
          vessel_name: form.vessel_name,
          vessel_type: form.vessel_type,
          make: form.make,
          model: form.model,
          year: Number.parseInt(form.year, 10),
          length_ft: form.length_ft ? Number.parseFloat(form.length_ft) : null,
          draft_ft: form.draft_ft ? Number.parseFloat(form.draft_ft) : null,
          public_notes: form.public_notes || null,
          photo_url: form.photo_url || null,
          doc_registration_url: form.doc_registration_url || null,
          doc_insurance_url: form.doc_insurance_url || null,
          storage_type: form.storage_type,
          storage_state: form.storage_state,
          storage_city: form.storage_city || null,
          storage_description: form.storage_description || null,
          marina_name: form.marina_name || null,
          slip_number: form.slip_number || null,
          marina_phone: form.marina_phone || null,
          is_liveaboard: form.is_liveaboard,
          slip_notes: form.slip_notes || null,
        },
        mxeId || undefined,
      );

      if (!result.mxeId) {
        setGeneralError(result.error ?? "Failed to create vessel.");
        setCapReached(result.code === "VESSEL_CAP_REACHED");
        return;
      }
      router.push(`/dashboard/${encodeURIComponent(result.mxeId)}/payment`);
    });
  }

  return (
    <div className="rounded-2xl border border-[var(--divider)] bg-[var(--white)] p-4 sm:p-6">
      <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        Step {step} / 4
      </p>
      <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-[var(--cream2)]">
        <div
          className="h-full rounded-full bg-[var(--aqua-bright)] transition-all"
          style={{ width: `${(step / 4) * 100}%` }}
        />
      </div>

      {step === 1 ? (
        <div className="mt-6 grid gap-4">
          <Field label="Vessel name" required error={errors.vessel_name}>
            <input value={form.vessel_name} onBlur={() => onBlur("vessel_name")} onChange={(e) => setForm((p) => ({ ...p, vessel_name: e.target.value }))} className="input" />
          </Field>
          <Field label="Vessel type" required>
            <select value={form.vessel_type} onChange={(e) => setForm((p) => ({ ...p, vessel_type: e.target.value }))} className="input">
              {vesselTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Make / Manufacturer" required error={errors.make}>
            <input value={form.make} onBlur={() => onBlur("make")} onChange={(e) => setForm((p) => ({ ...p, make: e.target.value }))} className="input" />
          </Field>
          <Field label="Model" required error={errors.model}>
            <input value={form.model} onBlur={() => onBlur("model")} onChange={(e) => setForm((p) => ({ ...p, model: e.target.value }))} className="input" />
          </Field>
          <Field label="Year" required error={errors.year}>
            <input type="number" min={1900} max={2030} value={form.year} onBlur={() => onBlur("year")} onChange={(e) => setForm((p) => ({ ...p, year: e.target.value }))} className="input" />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Length (ft)">
              <input type="number" value={form.length_ft} onChange={(e) => setForm((p) => ({ ...p, length_ft: e.target.value }))} className="input" />
            </Field>
            <Field label="Draft (ft)">
              <input type="number" value={form.draft_ft} onChange={(e) => setForm((p) => ({ ...p, draft_ft: e.target.value }))} className="input" />
            </Field>
          </div>
          <Field label="Public notes">
            <textarea value={form.public_notes} onChange={(e) => setForm((p) => ({ ...p, public_notes: e.target.value }))} className="input min-h-24" />
          </Field>
        </div>
      ) : null}

      {step === 2 ? (
        <div className="mt-6 grid gap-5">
          {/* State first, and required — the authoritative structured
              location field. Everything below it is optional, so this
              step adds exactly one blocker. */}
          <Field label="What state is your vessel stored in?" required error={errors.storage_state}>
            <select
              value={form.storage_state}
              onChange={(e) => {
                const next = e.target.value;
                setForm((p) => ({ ...p, storage_state: next }));
                if (next) setErrors((p) => ({ ...p, storage_state: "" }));
              }}
              className="input"
            >
              <option value="">Select a state…</option>
              {US_STATES.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.name}
                </option>
              ))}
            </select>
          </Field>

          <Field label="How is it stored?">
            <StorageTypePicker
              value={form.storage_type}
              onChange={(next) => setForm((p) => ({ ...p, storage_type: next }))}
            />
          </Field>

          {/* City sits outside the marina branch, so trailer/home/yard
              vessels capture a real city too — previously they had no
              city field at all and could only be described in free
              text, which is what made them unclassifiable. */}
          <Field label="City">
            <input
              value={form.storage_city}
              onChange={(e) => setForm((p) => ({ ...p, storage_city: e.target.value }))}
              placeholder="e.g. Oakland"
              className="input"
            />
          </Field>

          {isMarinaGroup(form.storage_type) ? (
            <>
              <Field label="Marina name">
                <input
                  value={form.marina_name}
                  onChange={(e) => setForm((p) => ({ ...p, marina_name: e.target.value }))}
                  placeholder="e.g. Portobello Marina"
                  className="input"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Slip number">
                  <input
                    value={form.slip_number}
                    onChange={(e) => setForm((p) => ({ ...p, slip_number: e.target.value }))}
                    placeholder="e.g. 38, B-12"
                    className="input"
                  />
                </Field>
                <Field label="Marina phone">
                  <input
                    type="tel"
                    value={form.marina_phone}
                    onChange={(e) => setForm((p) => ({ ...p, marina_phone: e.target.value }))}
                    placeholder="(510) 555-0110"
                    className="input"
                  />
                </Field>
              </div>
              <Field label="Liveaboard?">
                <select
                  value={form.is_liveaboard ? "yes" : "no"}
                  onChange={(e) => setForm((p) => ({ ...p, is_liveaboard: e.target.value === "yes" }))}
                  className="input"
                >
                  <option value="no">No</option>
                  <option value="yes">Yes</option>
                </select>
              </Field>
              <Field label="Slip / mooring notes">
                <textarea
                  value={form.slip_notes}
                  onChange={(e) => setForm((p) => ({ ...p, slip_notes: e.target.value }))}
                  placeholder="Optional — anything marina staff should know."
                  className="input min-h-24"
                />
              </Field>
            </>
          ) : (
            <Field label="Location detail">
              <input
                value={form.storage_description}
                onChange={(e) => setForm((p) => ({ ...p, storage_description: e.target.value }))}
                placeholder="e.g. Bay Marine Boatworks"
                className="input"
              />
              <span className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
                Optional. City and state are already captured above — use this only to add a specific place name.
                Appears on your public profile in place of a marina name.
              </span>
            </Field>
          )}
        </div>
      ) : null}

      {step === 3 ? (
        <div className="mt-6 grid gap-5">
          <UploadField
            label="Vessel photo"
            accept="image/*"
            progress={uploadProgress.photo}
            note={form.photo_url ? "Uploaded" : "Image, max 10MB"}
            onChange={(files) => onUpload(files, "photo", "photo_url", "photo")}
          />
          {form.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={form.photo_url} alt="Vessel preview" className="h-40 w-full rounded-xl object-cover" />
          ) : null}
          <UploadField
            label="Registration document (optional)"
            accept="application/pdf,image/*"
            progress={uploadProgress.registration}
            note={form.doc_registration_url ? "Uploaded" : "PDF or image, max 10MB"}
            onChange={(files) => onUpload(files, "registration", "doc_registration_url", "registration")}
          />
          <UploadField
            label="Insurance card (optional)"
            accept="application/pdf,image/*"
            progress={uploadProgress.insurance}
            note={form.doc_insurance_url ? "Uploaded" : "PDF or image, max 10MB"}
            onChange={(files) => onUpload(files, "insurance", "doc_insurance_url", "insurance")}
          />
        </div>
      ) : null}

      {step === 4 ? (
        <div className="mt-6 space-y-3 rounded-xl border border-[var(--divider)] bg-[var(--cream)] p-4">
          <p className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
            Assigned MXE ID
          </p>
          <p className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--gold)]">{mxeId || "Generating..."}</p>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {form.vessel_name} · {form.make} {form.model} · {form.year}
          </p>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">
            {[
              storageTypeLabel[form.storage_type],
              isMarinaGroup(form.storage_type) ? form.marina_name : form.storage_description,
              [form.storage_city, form.storage_state].filter(Boolean).join(", "),
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">{form.public_notes || "No public notes provided."}</p>
        </div>
      ) : null}

      {generalError ? (
        <div className="mt-4">
          <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{generalError}</p>
          {capReached ? (
            <Link
              href="/dashboard/upgrade"
              className="mt-1.5 inline-flex items-center gap-1 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)] underline underline-offset-2"
            >
              Upgrade to Full Access →
            </Link>
          ) : null}
        </div>
      ) : null}

      <div className="mt-6 flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => setStep((s) => Math.max(1, s - 1))}
          disabled={step === 1 || pending || uploading}
          className="rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] disabled:opacity-40"
        >
          Back
        </button>
        {step < 4 ? (
          <button
            type="button"
            onClick={stepForward}
            disabled={pending || uploading}
            className="rounded-lg bg-[var(--aqua-bright)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40"
          >
            {pending ? "Loading..." : "Continue"}
          </button>
        ) : (
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || uploading}
            className="rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)] disabled:opacity-40"
          >
            {pending ? "Registering..." : "Register Vessel"}
          </button>
        )}
      </div>

      <style jsx>{`
        .input {
          width: 100%;
          border-radius: 0.6rem;
          border: 1px solid var(--divider);
          background: var(--white);
          padding: 0.62rem 0.72rem;
          font-family: var(--font-dm), system-ui, sans-serif;
          font-size: 0.92rem;
          color: var(--text);
        }
      `}</style>
    </div>
  );
}

function Field({
  label,
  required,
  error,
  children,
}: {
  label: string;
  required?: boolean;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        {label}
        {required ? " *" : ""}
      </span>
      {children}
      {error ? <span className="font-[family-name:var(--font-dm)] text-xs text-[var(--red-fg)]">{error}</span> : null}
    </label>
  );
}

function UploadField({
  label,
  accept,
  progress,
  note,
  onChange,
}: {
  label: string;
  accept: string;
  progress: number;
  note: string;
  onChange: (files: FileList | null) => void;
}) {
  return (
    <label className="flex flex-col gap-2">
      <span className="font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]">
        {label}
      </span>
      <input
        type="file"
        accept={accept}
        onChange={(e) => onChange(e.target.files)}
        className="block w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] p-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]"
      />
      <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--cream2)]">
        <div className="h-full bg-[var(--aqua-bright)] transition-all" style={{ width: `${progress}%` }} />
      </div>
      <span className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">{note}</span>
    </label>
  );
}
