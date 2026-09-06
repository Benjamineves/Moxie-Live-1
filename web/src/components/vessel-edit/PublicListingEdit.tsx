"use client";

import { useState } from "react";
import { useSectionEdit } from "@/lib/useSectionEdit";
import { updateVesselIntrinsicFields, updateVesselOwnerFields } from "@/lib/owner-actions";
import { diffFields } from "@/lib/fieldDiff";
import { ConfirmDialog, FieldDiffList } from "@/components/ConfirmDialog";
import { inputClass, labelClass, editTriggerClass, saveButtonClass, cancelButtonClass } from "./formStyles";

type Fields = { vessel_name: string; public_notes: string };

const LABELS: Record<"vessel_name", string> = { vessel_name: "Vessel name" };

/**
 * The Public listing section's single editor, replacing what used to be
 * VesselDetailsEdit and NotesEdit — two separate triggers for the two
 * halves of one thing a scanner sees.
 *
 * The two fields keep their own save semantics, which is the only reason
 * this isn't a plain merge. vessel_name is vessel-intrinsic and stays
 * confirm-gated ("you're changing registered vessel data"); public_notes
 * is ordinary owner-editable text and saves straight through. So the
 * confirm step is conditional on what actually changed, not on which
 * form was opened: edit only the notes and there is no dialog, edit the
 * name and there is, exactly as before the two were combined.
 *
 * Only changed fields are written. An unchanged vessel_name would
 * otherwise hit the intrinsic-field audit trigger (see migration
 * 20260830_vessel_identity_lock_and_audit.sql) with a row recording a
 * change that never happened.
 */
export function PublicListingEdit({
  mxeId,
  vessel_name,
  public_notes,
}: {
  mxeId: string;
  vessel_name: string;
  public_notes: string | null | undefined;
}) {
  const initial: Fields = { vessel_name, public_notes: public_notes ?? "" };
  const { editing, values, setValues, error, pending, open, cancel, save } = useSectionEdit(initial);
  const [confirming, setConfirming] = useState(false);

  if (!editing) {
    return (
      <button type="button" onClick={open} className={editTriggerClass}>
        Edit
      </button>
    );
  }

  // Compared on the trimmed values that would actually be written, so
  // trailing whitespace alone counts as no change and raises no dialog.
  const nextName = values.vessel_name.trim();
  const nextNotes = values.public_notes.trim();
  const nameChanged = nextName !== initial.vessel_name.trim();
  const notesChanged = nextNotes !== initial.public_notes.trim();

  function persist() {
    save(async () => {
      if (nameChanged) {
        const result = await updateVesselIntrinsicFields(mxeId, { vessel_name: nextName });
        // Stop here rather than writing the notes too — a rejected
        // confirm-gated field shouldn't leave half the form applied.
        if (result.error) return result;
      }
      if (notesChanged) {
        const result = await updateVesselOwnerFields(mxeId, { public_notes: nextNotes || null });
        if (result.error) return result;
      }
      return {};
    });
  }

  function onSave() {
    if (nameChanged) {
      setConfirming(true);
      return;
    }
    persist();
  }

  return (
    <div className="mt-4 grid gap-3 rounded-xl border border-[var(--divider)] bg-[var(--white)] p-5 shadow-sm">
      <label className={labelClass}>
        Vessel name
        <input
          className={inputClass}
          value={values.vessel_name}
          onChange={(e) => setValues((p) => ({ ...p, vessel_name: e.target.value }))}
        />
      </label>
      <label className={labelClass}>
        Public notes
        <textarea
          className={`${inputClass} min-h-24`}
          value={values.public_notes}
          onChange={(e) => setValues((p) => ({ ...p, public_notes: e.target.value }))}
        />
      </label>
      {error ? <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--red-fg)]">{error}</p> : null}
      <div className="flex gap-2.5">
        <button type="button" onClick={cancel} disabled={pending} className={cancelButtonClass}>
          Cancel
        </button>
        <button type="button" onClick={onSave} disabled={pending} className={saveButtonClass}>
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        title="You're changing registered vessel data"
        pending={pending}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          persist();
        }}
      >
        {/* Only vessel_name is listed — public_notes isn't registered
            vessel data and isn't what this dialog is asking about, even
            when it's being saved in the same submission. */}
        <FieldDiffList
          diff={diffFields(
            { vessel_name: initial.vessel_name },
            { vessel_name: nextName },
            LABELS,
          )}
        />
      </ConfirmDialog>
    </div>
  );
}
