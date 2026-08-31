"use client";

export type StorageType = "marina" | "mooring" | "trailer" | "home" | "yard" | "other";

export const storageTypeOptions: { value: StorageType; icon: string; label: string }[] = [
  { value: "marina", icon: "⚓", label: "Marina / Slip" },
  { value: "mooring", icon: "🔴", label: "Mooring" },
  { value: "trailer", icon: "🚛", label: "Trailer" },
  { value: "home", icon: "🏠", label: "Home / Driveway" },
  { value: "yard", icon: "🏗️", label: "Boatyard / Storage" },
];

export const storageTypeLabel: Record<StorageType, string> = {
  marina: "Marina",
  mooring: "Mooring",
  trailer: "Trailer",
  home: "Home / Driveway",
  yard: "Boatyard / Storage",
  other: "Other",
};

export function isMarinaGroup(storageType: StorageType) {
  return storageType === "marina" || storageType === "mooring";
}

/**
 * Pill selector pattern from the intake form's step 2, extracted so the
 * owner-profile storage edit can reuse it exactly rather than reimplement
 * it. Note there's no "other" pill here even though StorageType/
 * storageTypeLabel include it — that mirrors intake's existing gap
 * (reachable via seed data, not selectable through this UI) rather than
 * fixing it, which wasn't asked for here.
 */
export function StorageTypePicker({
  value,
  onChange,
}: {
  value: StorageType;
  onChange: (next: StorageType) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {storageTypeOptions.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`rounded-lg border px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-medium transition ${
            value === opt.value
              ? "border-[var(--gold)] bg-[var(--gold-dim)] text-[var(--navy)]"
              : "border-[var(--divider)] bg-[var(--white)] text-[var(--text2)] hover:border-[var(--gold-line)]"
          }`}
        >
          {opt.icon} {opt.label}
        </button>
      ))}
    </div>
  );
}
