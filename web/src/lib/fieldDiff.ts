/** Builds the "old -> new" list shown in the vessel-intrinsic confirm dialog. */
export function diffFields<T extends Record<string, string>>(
  initial: T,
  next: T,
  labels: Record<keyof T, string>,
): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  for (const key of Object.keys(labels) as (keyof T)[]) {
    if (initial[key] !== next[key]) {
      out.push({ label: labels[key], from: initial[key], to: next[key] });
    }
  }
  return out;
}
