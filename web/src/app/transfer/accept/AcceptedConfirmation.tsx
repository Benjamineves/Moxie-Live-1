import Link from "next/link";

/**
 * The moment the buyer completes their side of the purchase. It gets its
 * own screen rather than reusing TerminalMessage, because every other
 * state on this page is a dead end being explained and this one is an
 * outcome being confirmed.
 */
export function AcceptedConfirmation({ mxeId }: { mxeId: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--cream)] px-6 py-12 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-[var(--green-bg)]">
        <svg
          viewBox="0 0 24 24"
          className="h-6 w-6 stroke-[var(--green-fg)]"
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
          <polyline points="22 4 12 14.01 9 11.01" />
        </svg>
      </div>
      <h1 className="mt-5 font-[family-name:var(--font-display)] text-3xl font-light text-[var(--navy)]">
        You&apos;ve accepted <em className="text-[var(--gold-deep)] not-italic">{mxeId}.</em>
      </h1>
      <p className="mt-3 max-w-sm font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
        That&apos;s your side done — there&apos;s nothing else for you to do, and nothing for you to pay. The seller
        pays the transfer fee, and {mxeId} moves to you the moment it clears.
      </p>
      <p className="mt-3 max-w-sm font-[family-name:var(--font-dm)] text-sm leading-relaxed text-[var(--text2)]">
        It will appear in your dashboard then, and we&apos;ll email you as soon as it does.
      </p>
      <Link
        href="/dashboard"
        className="mt-7 rounded-lg bg-[var(--navy-deep)] px-5 py-3 font-[family-name:var(--font-dm)] text-sm font-semibold text-[var(--gold)]"
      >
        Go to your dashboard
      </Link>
    </div>
  );
}
