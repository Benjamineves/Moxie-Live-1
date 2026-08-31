"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = {
  ins_carrier: string;
  ins_broker: string;
  ins_policy: string;
  ins_expiry: string;
  ins_liability: string;
};

export function InsuranceEdit({
  mxeId,
  ins_carrier,
  ins_broker,
  ins_policy,
  ins_expiry,
  ins_liability,
}: { mxeId: string } & {
  ins_carrier: string | null | undefined;
  ins_broker: string | null | undefined;
  ins_policy: string | null | undefined;
  ins_expiry: string | null | undefined;
  ins_liability: string | null | undefined;
}) {
  const initial: Fields = {
    ins_carrier: ins_carrier ?? "",
    ins_broker: ins_broker ?? "",
    ins_policy: ins_policy ?? "",
    ins_expiry: ins_expiry ?? "",
    ins_liability: ins_liability ?? "",
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
        Carrier
        <input
          className={inputClass}
          value={values.ins_carrier}
          onChange={(e) => setValues((p) => ({ ...p, ins_carrier: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Broker
        <input
          className={inputClass}
          value={values.ins_broker}
          onChange={(e) => setValues((p) => ({ ...p, ins_broker: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Policy
        <input
          className={inputClass}
          value={values.ins_policy}
          onChange={(e) => setValues((p) => ({ ...p, ins_policy: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Expiry
        <input
          type="date"
          className={inputClass}
          value={values.ins_expiry}
          onChange={(e) => setValues((p) => ({ ...p, ins_expiry: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Liability
        <input
          className={inputClass}
          value={values.ins_liability}
          onChange={(e) => setValues((p) => ({ ...p, ins_liability: e.target.value }))}
          placeholder="e.g. $300,000"
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
                ins_carrier: values.ins_carrier.trim() || null,
                ins_broker: values.ins_broker.trim() || null,
                ins_policy: values.ins_policy.trim() || null,
                ins_expiry: values.ins_expiry.trim() || null,
                ins_liability: values.ins_liability.trim() || null,
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
