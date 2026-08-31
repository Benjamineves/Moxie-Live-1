"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = {
  fuel_type: string;
  max_persons: string;
  lifejackets: string;
  fire_extinguisher: boolean;
  flares: boolean;
  sound_device: boolean;
  ca_boater_card: boolean;
};

/** engine was removed — it's a locked, identity-defining field now (see owner-actions.ts); no self-serve edit path here. */
export function SafetyEdit({
  mxeId,
  fuel_type,
  max_persons,
  lifejackets,
  fire_extinguisher,
  flares,
  sound_device,
  ca_boater_card,
}: {
  mxeId: string;
  fuel_type: string | null | undefined;
  max_persons: number | null | undefined;
  lifejackets: number | null | undefined;
  fire_extinguisher: boolean | null | undefined;
  flares: boolean | null | undefined;
  sound_device: boolean | null | undefined;
  ca_boater_card: boolean | null | undefined;
}) {
  const initial: Fields = {
    fuel_type: fuel_type ?? "",
    max_persons: max_persons != null ? String(max_persons) : "",
    lifejackets: lifejackets != null ? String(lifejackets) : "",
    fire_extinguisher: fire_extinguisher ?? false,
    flares: flares ?? false,
    sound_device: sound_device ?? false,
    ca_boater_card: ca_boater_card ?? false,
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
        Fuel type
        <input
          className={inputClass}
          value={values.fuel_type}
          onChange={(e) => setValues((p) => ({ ...p, fuel_type: e.target.value }))}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Max persons
          <input
            type="number"
            min={0}
            className={inputClass}
            value={values.max_persons}
            onChange={(e) => setValues((p) => ({ ...p, max_persons: e.target.value }))}
          />
        </label>
        <label className={labelClass}>
          Life jackets
          <input
            type="number"
            min={0}
            className={inputClass}
            value={values.lifejackets}
            onChange={(e) => setValues((p) => ({ ...p, lifejackets: e.target.value }))}
          />
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <label className="flex items-center gap-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={values.fire_extinguisher}
            onChange={(e) => setValues((p) => ({ ...p, fire_extinguisher: e.target.checked }))}
          />
          Fire extinguisher
        </label>
        <label className="flex items-center gap-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={values.flares}
            onChange={(e) => setValues((p) => ({ ...p, flares: e.target.checked }))}
          />
          Flares
        </label>
        <label className="flex items-center gap-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={values.sound_device}
            onChange={(e) => setValues((p) => ({ ...p, sound_device: e.target.checked }))}
          />
          Sound device
        </label>
        <label className="flex items-center gap-2 font-[family-name:var(--font-dm)] text-sm text-[var(--text)]">
          <input
            type="checkbox"
            checked={values.ca_boater_card}
            onChange={(e) => setValues((p) => ({ ...p, ca_boater_card: e.target.checked }))}
          />
          CA boater card
        </label>
      </div>
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
                fuel_type: values.fuel_type.trim() || null,
                max_persons: values.max_persons.trim() ? Number.parseInt(values.max_persons, 10) : null,
                lifejackets: values.lifejackets.trim() ? Number.parseInt(values.lifejackets, 10) : null,
                fire_extinguisher: values.fire_extinguisher,
                flares: values.flares,
                sound_device: values.sound_device,
                ca_boater_card: values.ca_boater_card,
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
