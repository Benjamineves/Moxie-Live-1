"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = {
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  preferred_contact: string;
};

export function ContactEdit({
  mxeId,
  owner_name,
  owner_phone,
  owner_email,
  preferred_contact,
}: { mxeId: string } & {
  owner_name: string | null | undefined;
  owner_phone: string | null | undefined;
  owner_email: string | null | undefined;
  preferred_contact: string | null | undefined;
}) {
  const initial: Fields = {
    owner_name: owner_name ?? "",
    owner_phone: owner_phone ?? "",
    owner_email: owner_email ?? "",
    preferred_contact: preferred_contact ?? "",
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
        Owner name
        <input
          className={inputClass}
          value={values.owner_name}
          onChange={(e) => setValues((p) => ({ ...p, owner_name: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Owner phone
        <input
          className={inputClass}
          value={values.owner_phone}
          onChange={(e) => setValues((p) => ({ ...p, owner_phone: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Owner email
        <input
          type="email"
          className={inputClass}
          value={values.owner_email}
          onChange={(e) => setValues((p) => ({ ...p, owner_email: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Preferred contact
        <input
          className={inputClass}
          value={values.preferred_contact}
          onChange={(e) => setValues((p) => ({ ...p, preferred_contact: e.target.value }))}
          placeholder="e.g. phone, email, text"
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
                owner_name: values.owner_name.trim(),
                owner_phone: values.owner_phone.trim() || null,
                owner_email: values.owner_email.trim() || null,
                preferred_contact: values.preferred_contact.trim() || null,
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
