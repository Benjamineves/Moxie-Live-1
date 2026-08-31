"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = { emg_name: string; emg_phone: string; emg_relationship: string };

export function EmergencyEdit({
  mxeId,
  emg_name,
  emg_phone,
  emg_relationship,
}: {
  mxeId: string;
  emg_name: string | null | undefined;
  emg_phone: string | null | undefined;
  emg_relationship: string | null | undefined;
}) {
  const initial: Fields = {
    emg_name: emg_name ?? "",
    emg_phone: emg_phone ?? "",
    emg_relationship: emg_relationship ?? "",
  };
  const { editing, values, setValues, error, pending, open, cancel, save } = useSectionEdit(initial);

  if (!editing) {
    return (
      <button type="button" onClick={open} className={editTriggerClass}>
        Edit
      </button>
    );
  }

  return (
    <div className="mt-4 grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <label className={labelClass}>
        Name
        <input
          className={inputClass}
          value={values.emg_name}
          onChange={(e) => setValues((p) => ({ ...p, emg_name: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Phone
        <input
          className={inputClass}
          value={values.emg_phone}
          onChange={(e) => setValues((p) => ({ ...p, emg_phone: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Relationship
        <input
          className={inputClass}
          value={values.emg_relationship}
          onChange={(e) => setValues((p) => ({ ...p, emg_relationship: e.target.value }))}
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
            save(() =>
              updateVesselOwnerFields(mxeId, {
                emg_name: values.emg_name.trim() || null,
                emg_phone: values.emg_phone.trim() || null,
                emg_relationship: values.emg_relationship.trim() || null,
              }),
            )
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
