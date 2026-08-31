"use client";

import { useState } from "react";
import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselIntrinsicFields } from "@/lib/owner-actions";
import { diffFields } from "@/lib/fieldDiff";
import { ConfirmDialog, FieldDiffList } from "@/components/ConfirmDialog";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = { vessel_name: string };

const LABELS: Record<keyof Fields, string> = { vessel_name: "Vessel name" };

/**
 * Only vessel_name lives here now — make/model/year/vessel_type/length_ft/
 * draft_ft were removed entirely (not just gated) once those were
 * reclassified as locked, identity-defining fields with no self-serve edit
 * path at all (see owner-actions.ts). vessel_name stays confirm-gated,
 * unchanged, since renaming a boat is legitimate and doesn't touch which
 * physical object the record represents.
 */
export function VesselDetailsEdit({ mxeId, vessel_name }: { mxeId: string; vessel_name: string }) {
  const initial: Fields = { vessel_name };
  const { editing, values, setValues, error, pending, open, cancel, save } = useSectionEdit(initial);
  const [confirming, setConfirming] = useState(false);

  if (!editing) {
    return (
      <button type="button" onClick={open} className={editTriggerClass}>
        Edit vessel name
      </button>
    );
  }

  function doSave() {
    save(() => updateVesselIntrinsicFields(mxeId, { vessel_name: values.vessel_name.trim() }));
  }

  return (
    <div className="mx-auto mt-3 max-w-lg grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <label className={labelClass}>
        Vessel name
        <input
          className={inputClass}
          value={values.vessel_name}
          onChange={(e) => setValues({ vessel_name: e.target.value })}
        />
      </label>
      {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <div className="flex gap-2.5">
        <button type="button" onClick={cancel} disabled={pending} className={cancelButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={() => setConfirming(true)} disabled={pending} className={saveButtonClass}>
          Save
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="You're changing registered vessel data"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          doSave();
        }}
      >
        <FieldDiffList diff={diffFields(initial, values, LABELS)} />
      </ConfirmDialog>
    </div>
  );
}
