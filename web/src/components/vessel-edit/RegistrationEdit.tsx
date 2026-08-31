"use client";

import { useState } from "react";
import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselIntrinsicFields } from "@/lib/owner-actions";
import { diffFields } from "@/lib/fieldDiff";
import { ConfirmDialog, FieldDiffList } from "@/components/ConfirmDialog";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = { reg_state: string; reg_number: string; reg_expiry: string };

const LABELS: Record<keyof Fields, string> = {
  reg_state: "Reg. state",
  reg_number: "Reg. number",
  reg_expiry: "Reg. expiry",
};

/**
 * HIN/USCG doc #/official number were removed entirely (not just gated) —
 * those identify the physical vessel and have no self-serve edit path at
 * all now (see owner-actions.ts). reg_state/reg_number/reg_expiry stay
 * here, confirm-gated as before: re-registration (new state, renewed
 * number/expiry) is legitimate and doesn't touch vessel identity.
 */
export function RegistrationEdit({
  mxeId,
  reg_state,
  reg_number,
  reg_expiry,
}: {
  mxeId: string;
  reg_state: string | null | undefined;
  reg_number: string | null | undefined;
  reg_expiry: string | null | undefined;
}) {
  const initial: Fields = {
    reg_state: reg_state ?? "",
    reg_number: reg_number ?? "",
    reg_expiry: reg_expiry ?? "",
  };
  const { editing, values, setValues, error, pending, open, cancel, save } = useSectionEdit(initial);
  const [confirming, setConfirming] = useState(false);

  if (!editing) {
    return (
      <button type="button" onClick={open} className={editTriggerClass}>
        Edit
      </button>
    );
  }

  function doSave() {
    save(() =>
      updateVesselIntrinsicFields(mxeId, {
        reg_state: values.reg_state.trim() || null,
        reg_number: values.reg_number.trim() || null,
        reg_expiry: values.reg_expiry.trim() || null,
      }),
    );
  }

  return (
    <div className="mt-4 grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <div className="grid grid-cols-2 gap-3">
        <label className={labelClass}>
          Reg. state
          <input
            className={inputClass}
            value={values.reg_state}
            onChange={(e) => setValues((p) => ({ ...p, reg_state: e.target.value }))}
          />
        </label>
        <label className={labelClass}>
          Reg. number
          <input
            className={inputClass}
            value={values.reg_number}
            onChange={(e) => setValues((p) => ({ ...p, reg_number: e.target.value }))}
          />
        </label>
      </div>
      <label className={labelClass}>
        Reg. expiry
        <input
          type="date"
          className={inputClass}
          value={values.reg_expiry}
          onChange={(e) => setValues((p) => ({ ...p, reg_expiry: e.target.value }))}
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
