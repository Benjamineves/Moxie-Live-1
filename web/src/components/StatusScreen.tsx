import Link from "next/link";

/**
 * The full-page shell the 404 boundaries and the badge-scan error boundary
 * render through, so they differ only in their words.
 *
 * Why there are several: `app/not-found.tsx` catches every unmatched URL in
 * the app, and it used to say "That vessel code does not exist or is not
 * published yet" to all of them — including `/dashboard/MXE-01024`, which
 * is a real vessel reached by a route that did not exist. That cost real
 * diagnosis time on the transfer CTA bug, because a routing mistake read
 * as a failed database lookup. A message is only allowed to name a vessel,
 * a badge or a batch where the thing that failed genuinely was one — and
 * an error boundary must not name any of them, because a failure on our
 * side is not a verdict on what the visitor was holding.
 *
 * No hooks and no server-only imports, so it renders in both a server
 * boundary and a client one (`error.tsx` must be a client component).
 */
export function StatusScreen({
  title,
  accent,
  body,
  href = "/",
  action = "Back to home",
  children,
}: {
  title: string;
  /** The italic gold clause that closes the heading. */
  accent: string;
  body: string;
  /** Pass null for a screen whose only action is `children` (e.g. Try again). */
  href?: string | null;
  action?: string;
  /** Extra controls, shown above the link. */
  children?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--cream)] px-6 text-center">
      <h1 className="font-[family-name:var(--font-display)] text-3xl font-light italic text-[var(--navy)]">
        {title} <em className="text-[var(--gold-deep)] not-italic">{accent}</em>
      </h1>
      <p className="mt-3 max-w-sm font-[family-name:var(--font-dm)] text-sm text-[var(--text2)]">{body}</p>
      {children ? <div className="mt-8">{children}</div> : null}
      {href ? (
        <Link
          className={`${children ? "mt-4" : "mt-8"} font-[family-name:var(--font-dm)] text-sm text-[var(--blue-fg)] underline`}
          href={href}
        >
          {action}
        </Link>
      ) : null}
    </div>
  );
}
