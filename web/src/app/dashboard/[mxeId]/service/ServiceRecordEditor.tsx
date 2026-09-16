"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SERVICE_CATEGORIES, type ServiceRecord } from "@/lib/service-records";
import { uploadServiceRecordFile } from "@/lib/vessel-uploads";
import { addServiceRecord, editServiceRecord, removeServiceRecord } from "./actions";

/**
 * Add and edit service entries.
 *
 * WHAT THIS DELIBERATELY CANNOT DO is set the logged date. There is no
 * field for it, the action takes no argument for it, and the database
 * would put the old value back anyway. An owner can log something that
 * happened in 2019 today — back-dating the *service* date is expected and
 * allowed, because people log late — but the record will say it was logged
 * today, and that is the half a buyer reads.
 */

const field =
  "rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2";
const labelClass = "font-[family-name:var(--font-dm)] text-[11px] uppercase tracking-[0.12em] text-[var(--text3)]";

type Draft = { serviceDate: string; category: string; description: string; provider: string };

const EMPTY: Draft = { serviceDate: "", category: "engine", description: "", provider: "" };

export function ServiceRecordEditor({ mxeId, records }: { mxeId: string; records: ServiceRecord[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  function reset() {
    setDraft(EMPTY);
    setFile(null);
    setEditing(null);
    setOpen(false);
    setError(null);
  }

  async function submit() {
    setError(null);
    setBusy(true);
    try {
      if (editing) {
        const result = await editServiceRecord(mxeId, editing, draft);
        if (result.error) throw new Error(result.error);
      } else {
        // Uploaded from the browser, so the bytes never pass through a
        // server action's payload limit. The path lands under the signed-in
        // user's own folder, which is what keeps a seller's attachments
        // theirs after a transfer.
        let attached: { path: string; name: string; sizeBytes: number | null } | null = null;
        if (file) {
          const up = await uploadServiceRecordFile(file, mxeId);
          attached = { path: up.path, name: up.fileName, sizeBytes: file.size };
        }
        const result = await addServiceRecord(mxeId, { ...draft, file: attached });
        if (result.error) throw new Error(result.error);
      }
      reset();
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    setError(null);
    setBusy(true);
    try {
      const result = await removeServiceRecord(mxeId, id);
      if (result.error) throw new Error(result.error);
      startTransition(() => router.refresh());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)]"
        >
          Log a service
        </button>
        {records.length > 0 ? (
          <EditList records={records} busy={busy} onEdit={(r) => {
            setEditing(r.id);
            setDraft({ serviceDate: r.service_date.slice(0, 10), category: r.category, description: r.description, provider: r.provider ?? "" });
            setOpen(true);
          }} onDelete={onDelete} />
        ) : null}
        {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      </div>
    );
  }

  return (
    <form
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
      className="flex flex-col gap-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5"
    >
      <p className="font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy)]">
        {editing ? "Edit entry" : "Log a service"}
      </p>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Service date</span>
        <input
          type="date"
          required
          max={today}
          value={draft.serviceDate}
          onChange={(e) => setDraft({ ...draft, serviceDate: e.target.value })}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Category</span>
        <select value={draft.category} onChange={(e) => setDraft({ ...draft, category: e.target.value })} className={field}>
          {SERVICE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>What was done</span>
        <textarea
          required
          rows={3}
          maxLength={2000}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
          className={field}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className={labelClass}>Who did it (optional)</span>
        <input
          type="text"
          maxLength={200}
          value={draft.provider}
          onChange={(e) => setDraft({ ...draft, provider: e.target.value })}
          className={field}
        />
      </label>

      {!editing ? (
        <label className="flex flex-col gap-1.5">
          <span className={labelClass}>Invoice or receipt (optional)</span>
          <input type="file" accept="application/pdf,image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className={field} />
          <span className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--text3)]">
            Stays yours if you sell the boat. The entry carries to the buyer; the file does not.
          </span>
        </label>
      ) : null}

      {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}

      <div className="flex gap-2.5">
        <button
          type="submit"
          disabled={busy || pending}
          className="rounded-lg bg-[var(--navy)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--gold)] disabled:opacity-50"
        >
          {busy ? "Saving…" : editing ? "Save changes" : "Log it"}
        </button>
        <button
          type="button"
          onClick={reset}
          className="rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text2)]"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function EditList({
  records, busy, onEdit, onDelete,
}: {
  records: ServiceRecord[];
  busy: boolean;
  onEdit: (r: ServiceRecord) => void;
  onDelete: (id: string) => void;
}) {
  const [target, setTarget] = useState<string>("");
  const selected = records.find((r) => r.id === target) ?? null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={target} onChange={(e) => setTarget(e.target.value)} className={`${field} max-w-[280px]`}>
        <option value="">Edit an entry…</option>
        {records.map((r) => (
          <option key={r.id} value={r.id}>
            {r.service_date.slice(0, 10)} · {r.description.slice(0, 40)}
          </option>
        ))}
      </select>
      {selected ? (
        <>
          <button
            type="button"
            onClick={() => onEdit(selected)}
            className="font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--gold-deep)] underline underline-offset-2"
          >
            Edit
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => onDelete(selected.id)}
            className="font-[family-name:var(--font-dm)] text-xs font-medium text-[var(--red-fg)] underline underline-offset-2 disabled:opacity-50"
          >
            Delete
          </button>
        </>
      ) : null}
    </div>
  );
}
