"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { StorageTypePicker, isMarinaGroup, type StorageType } from "@/components/StorageTypePicker";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = {
  storage_type: StorageType;
  storage_description: string;
  marina_name: string;
  marina_city: string;
  slip_number: string;
  marina_phone: string;
  is_liveaboard: boolean;
  slip_notes: string;
};

export function StorageEdit({
  mxeId,
  storage_type,
  storage_description,
  marina_name,
  marina_city,
  slip_number,
  marina_phone,
  is_liveaboard,
  slip_notes,
}: {
  mxeId: string;
  storage_type: string | null | undefined;
  storage_description: string | null | undefined;
  marina_name: string | null | undefined;
  marina_city: string | null | undefined;
  slip_number: string | null | undefined;
  marina_phone: string | null | undefined;
  is_liveaboard: boolean | null | undefined;
  slip_notes: string | null | undefined;
}) {
  const initial: Fields = {
    storage_type: (storage_type as StorageType) ?? "marina",
    storage_description: storage_description ?? "",
    marina_name: marina_name ?? "",
    marina_city: marina_city ?? "",
    slip_number: slip_number ?? "",
    marina_phone: marina_phone ?? "",
    is_liveaboard: is_liveaboard ?? false,
    slip_notes: slip_notes ?? "",
  };
  const { editing, values, setValues, error, pending, open, cancel, save } = useSectionEdit(initial);

  if (!editing) {
    return (
      <button type="button" onClick={open} className={editTriggerClass}>
        Edit
      </button>
    );
  }

  const marinaGroup = isMarinaGroup(values.storage_type);

  return (
    <div className="mt-4 grid gap-4 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <label className={labelClass}>
        Where is your vessel stored?
        <div className="mt-1 normal-case tracking-normal">
          <StorageTypePicker
            value={values.storage_type}
            onChange={(next) => setValues((p) => ({ ...p, storage_type: next }))}
          />
        </div>
      </label>

      {marinaGroup ? (
        <>
          <label className={labelClass}>
            Marina name
            <input
              className={inputClass}
              value={values.marina_name}
              onChange={(e) => setValues((p) => ({ ...p, marina_name: e.target.value }))}
            />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              City, State
              <input
                className={inputClass}
                value={values.marina_city}
                onChange={(e) => setValues((p) => ({ ...p, marina_city: e.target.value }))}
              />
            </label>
            <label className={labelClass}>
              Slip number
              <input
                className={inputClass}
                value={values.slip_number}
                onChange={(e) => setValues((p) => ({ ...p, slip_number: e.target.value }))}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <label className={labelClass}>
              Marina phone
              <input
                type="tel"
                className={inputClass}
                value={values.marina_phone}
                onChange={(e) => setValues((p) => ({ ...p, marina_phone: e.target.value }))}
              />
            </label>
            <label className={labelClass}>
              Liveaboard?
              <select
                className={inputClass}
                value={values.is_liveaboard ? "yes" : "no"}
                onChange={(e) => setValues((p) => ({ ...p, is_liveaboard: e.target.value === "yes" }))}
              >
                <option value="no">No</option>
                <option value="yes">Yes</option>
              </select>
            </label>
          </div>
          <label className={labelClass}>
            Slip / mooring notes
            <textarea
              className={`${inputClass} min-h-20`}
              value={values.slip_notes}
              onChange={(e) => setValues((p) => ({ ...p, slip_notes: e.target.value }))}
            />
          </label>
        </>
      ) : (
        <label className={labelClass}>
          Storage location
          <input
            className={inputClass}
            value={values.storage_description}
            onChange={(e) => setValues((p) => ({ ...p, storage_description: e.target.value }))}
            placeholder="e.g. Home — Walnut Creek, CA"
          />
        </label>
      )}

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
                storage_type: values.storage_type,
                storage_description: marinaGroup ? null : values.storage_description.trim() || null,
                marina_name: marinaGroup ? values.marina_name.trim() || null : null,
                marina_city: marinaGroup ? values.marina_city.trim() || null : null,
                slip_number: marinaGroup ? values.slip_number.trim() || null : null,
                marina_phone: marinaGroup ? values.marina_phone.trim() || null : null,
                is_liveaboard: marinaGroup ? values.is_liveaboard : null,
                slip_notes: marinaGroup ? values.slip_notes.trim() || null : null,
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
