"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

export function NotesEdit({ mxeId, public_notes }: { mxeId: string; public_notes: string | null | undefined }) {
  const { editing, values, setValues, error, pending, open, cancel, save } = useSectionEdit({
    public_notes: public_notes ?? "",
  });

  if (!editing) {
    return (
      <button type="button" onClick={open} className={editTriggerClass}>
        Edit public notes
      </button>
    );
  }

  return (
    <div className="mx-auto mt-3 max-w-lg grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <label className={labelClass}>
        Public notes
        <textarea
          className={`${inputClass} min-h-24`}
          value={values.public_notes}
          onChange={(e) => setValues({ public_notes: e.target.value })}
        />
      </label>
      {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <div className="flex gap-2.5">
        <button type="button" onClick={cancel} disabled={pending} className={cancelButtonClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() =>
            save(() => updateVesselOwnerFields(mxeId, { public_notes: values.public_notes.trim() || null }))
          }
          disabled={pending}
          className={saveButtonClass}
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>
    </div>
  );
}
