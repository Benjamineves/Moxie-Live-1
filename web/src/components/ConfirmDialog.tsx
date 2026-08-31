"use client";

/**
 * Generic confirm step, used before saving vessel-intrinsic fields
 * (VesselDetailsEdit, RegistrationEdit) — "you're changing registered
 * vessel data" friction, not just a save button. Deliberately dumb/
 * content-agnostic so both callers can pass their own diff summary as
 * children rather than this component knowing about vessel fields.
 */
export function ConfirmDialog({
  open,
  title,
  pending,
  onConfirm,
  onCancel,
  children,
}: {
  open: boolean;
  title: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[400] flex items-center justify-center bg-[rgba(7,16,32,.6)] p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-[var(--white)] p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="font-[family-name:var(--font-display)] text-xl italic text-[var(--navy)]">{title}</p>
        {children ? <div className="mt-3">{children}</div> : null}
        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)] disabled:opacity-40"
          >
            {pending ? "Saving…" : "Confirm & save"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small "old → new" diff list for the confirm dialog's body. */
export function FieldDiffList({ diff }: { diff: { label: string; from: string; to: string }[] }) {
  if (diff.length === 0) {
    return (
      <p className="font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">No fields were changed.</p>
    );
  }
  return (
    <ul className="flex flex-col gap-1.5">
      {diff.map((d) => (
        <li key={d.label} className="font-[family-name:var(--font-dm)] text-xs text-[var(--text2)]">
          <span className="uppercase tracking-[0.08em] text-[var(--text3)]">{d.label}</span>
          {": "}
          <span className="text-[var(--text3)] line-through">{d.from || "—"}</span>
          {" → "}
          <span className="font-medium text-[var(--navy)]">{d.to || "—"}</span>
        </li>
      ))}
    </ul>
  );
}
