export const inputClass =
  "w-full rounded-lg border border-[var(--divider)] bg-[var(--white)] px-3 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] outline-none ring-[var(--gold)] focus:ring-2";

export const labelClass =
  "flex flex-col gap-1 font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.12em] text-[var(--text3)]";

/**
 * The "Edit" affordance on a LIGHT card — nine of its ten call sites.
 *
 * It used --gold, which measures 2.29:1 on white and 1.99:1 on
 * --gray-bg: the most-used control in the owner dashboard, unreadable.
 * Its hover state was worse still — --gold-lt is LIGHTER, so hovering
 * took it to 1.77:1. --gold-deep is 5.84:1 and 5.08:1, and hover now
 * darkens to --navy (16.6:1) rather than fading out.
 *
 * The tenth call site is on a dark card and needs the opposite token —
 * see editTriggerOnDarkClass. Changing this one blindly would have taken
 * that trigger from 8.32:1 to 3.26:1, which is the trap in treating a
 * shared class as though every caller shared a background.
 */
export const editTriggerClass =
  "font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.1em] text-[var(--gold-deep)] underline decoration-[var(--gold-deep)] underline-offset-2 hover:text-[var(--navy)]";

/**
 * The same affordance on a DARK card. --gold is right here (8.32:1 on
 * --navy-deep) and --gold-deep would be wrong (3.26:1) — the exact
 * inverse of the light case. The --gold-lt hover works on dark too
 * (8.54:1), which is what it was designed against.
 */
export const editTriggerOnDarkClass =
  "font-[family-name:var(--font-dm)] text-xs font-medium uppercase tracking-[0.1em] text-[var(--gold)] underline decoration-[var(--gold-line)] underline-offset-2 hover:text-[var(--gold-lt)]";

export const saveButtonClass =
  "rounded-lg bg-[var(--navy-deep)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)] disabled:opacity-40";

export const cancelButtonClass =
  "rounded-lg border border-[var(--divider)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm text-[var(--text)] disabled:opacity-40";

/**
 * ON-DARK VARIANTS.
 *
 * saveButtonClass and cancelButtonClass above assume a light surface —
 * cancelButtonClass in particular is transparent with a --divider border
 * and --text label, which measures 1.10:1 on the transfer panel's
 * navy-deep card. That is not a subtle problem: the control is
 * unreadable, and a seller cancelled a real transfer because of it.
 *
 * Use these whenever the surface is dark. They are deliberately separate
 * classes rather than a prop on the originals, so the choice of surface
 * is visible at the call site.
 */

/** Primary action on a dark surface. Gold fill reads as the main action; 8.32:1. */
export const onDarkPrimaryButtonClass =
  "rounded-lg bg-[var(--gold)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--navy-deep)] disabled:opacity-40";

/**
 * Destructive action on a dark surface — outlined rather than filled, so
 * it is clearly subordinate to the primary action beside it, and warm
 * red rather than gold, so it is clearly not the same kind of thing.
 * Text 7.51:1, border 3.28:1.
 */
export const onDarkDangerButtonClass =
  "rounded-lg border border-[var(--danger-on-dark-line)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--danger-on-dark)] disabled:opacity-40";

/**
 * Destructive action on a LIGHT surface — the payment screen's exit.
 * Outlined for the same subordination reason as its on-dark twin.
 */
export const dangerButtonClass =
  "rounded-lg border border-[var(--red-fg)] px-4 py-2.5 font-[family-name:var(--font-dm)] text-sm font-medium text-[var(--red-fg)] disabled:opacity-40";
