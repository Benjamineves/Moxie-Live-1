"use client";

import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselOwnerFields } from "@/lib/owner-actions";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = {
  owner_name: string;
  owner_phone: string;
  owner_email: string;
  preferred_contact: string;
  mailing_line1: string;
  mailing_line2: string;
  mailing_city: string;
  mailing_state: string;
  mailing_zip: string;
};

export function ContactEdit({
  mxeId,
  owner_name,
  owner_phone,
  owner_email,
  preferred_contact,
  mailing_line1,
  mailing_line2,
  mailing_city,
  mailing_state,
  mailing_zip,
}: { mxeId: string } & {
  owner_name: string | null | undefined;
  owner_phone: string | null | undefined;
  owner_email: string | null | undefined;
  preferred_contact: string | null | undefined;
  /**
   * Where the physical badge ships (20260920_mailing_address.sql). First
   * captured by Stripe's AddressElement at checkout; this is the same
   * five columns, editable afterwards like any other contact detail.
   */
  mailing_line1: string | null | undefined;
  mailing_line2: string | null | undefined;
  mailing_city: string | null | undefined;
  mailing_state: string | null | undefined;
  mailing_zip: string | null | undefined;
}) {
  const initial: Fields = {
    owner_name: owner_name ?? "",
    owner_phone: owner_phone ?? "",
    owner_email: owner_email ?? "",
    preferred_contact: preferred_contact ?? "",
    mailing_line1: mailing_line1 ?? "",
    mailing_line2: mailing_line2 ?? "",
    mailing_city: mailing_city ?? "",
    mailing_state: mailing_state ?? "",
    mailing_zip: mailing_zip ?? "",
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
      <p className="mt-2 border-t border-[var(--divider)] pt-4 font-[family-name:var(--font-dm)] text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text3)]">
        Badge shipping address
      </p>
      <label className={labelClass}>
        Address
        <input
          className={inputClass}
          value={values.mailing_line1}
          onChange={(e) => setValues((p) => ({ ...p, mailing_line1: e.target.value }))}
          placeholder="Street address"
        />
      </label>
      <label className={labelClass}>
        Address line 2
        <input
          className={inputClass}
          value={values.mailing_line2}
          onChange={(e) => setValues((p) => ({ ...p, mailing_line2: e.target.value }))}
          placeholder="Apt, suite, slip office — optional"
        />
      </label>
      <div className="grid grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2.5">
        <label className={labelClass}>
          City
          <input
            className={inputClass}
            value={values.mailing_city}
            onChange={(e) => setValues((p) => ({ ...p, mailing_city: e.target.value }))}
          />
        </label>
        <label className={labelClass}>
          State
          <input
            className={inputClass}
            value={values.mailing_state}
            onChange={(e) => setValues((p) => ({ ...p, mailing_state: e.target.value }))}
            placeholder="CA"
            maxLength={2}
          />
        </label>
        <label className={labelClass}>
          ZIP
          <input
            className={inputClass}
            value={values.mailing_zip}
            onChange={(e) => setValues((p) => ({ ...p, mailing_zip: e.target.value }))}
            placeholder="94965"
          />
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
                owner_name: values.owner_name.trim(),
                owner_phone: values.owner_phone.trim() || null,
                owner_email: values.owner_email.trim() || null,
                preferred_contact: values.preferred_contact.trim() || null,
                mailing_line1: values.mailing_line1.trim() || null,
                mailing_line2: values.mailing_line2.trim() || null,
                mailing_city: values.mailing_city.trim() || null,
                // Upper-cased on save so a hand-typed "ca" and Stripe's
                // "CA" don't end up as two different values in one column.
                mailing_state: values.mailing_state.trim().toUpperCase() || null,
                mailing_zip: values.mailing_zip.trim() || null,
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
