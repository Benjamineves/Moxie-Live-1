"use client";

import { useState, useTransition } from "react";
import { updateStickerOrderStatus, type StickerOrderStatus } from "./actions";

const OPTIONS: { value: StickerOrderStatus; label: string }[] = [
  { value: "not_ordered", label: "Not ordered" },
  { value: "ordered", label: "Ordered" },
  { value: "printed", label: "Printed" },
  { value: "shipped", label: "Shipped" },
];

type Props = {
  mxeId: string;
  status: string;
  /** Called only after the DB write succeeds — parent owns what's rendered. */
  onChanged: (mxeId: string, status: StickerOrderStatus) => void;
};

export function StickerStatusSelect({ mxeId, status, onChanged }: Props) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function onChange(next: StickerOrderStatus) {
    setError(null);
    startTransition(async () => {
      const result = await updateStickerOrderStatus(mxeId, next);
      if (result.error) {
        setError(result.error);
        return;
      }
      onChanged(mxeId, next);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <select
        value={status}
        disabled={pending}
        onChange={(e) => onChange(e.target.value as StickerOrderStatus)}
        className="rounded-md border border-[var(--divider)] bg-[var(--white)] px-2 py-1.5 font-[family-name:var(--font-dm)] text-xs text-[var(--text)] disabled:opacity-50"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {error ? (
        <span className="font-[family-name:var(--font-dm)] text-[11px] text-[var(--red-fg)]">{error}</span>
      ) : null}
    </div>
  );
}
