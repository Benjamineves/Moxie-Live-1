import { StatusScreen } from "@/components/StatusScreen";

/**
 * The 404 for `/<something>` — one URL segment at the root.
 *
 * Two different misses reach this boundary, and Next gives it no way to
 * tell them apart. `/[mxeId]` is a root-level dynamic segment, so every
 * single-segment URL matches it, and page.tsx calls notFound() twice: once
 * for a segment that is not MXE-shaped at all (`/pricng` — a mistyped
 * page), and once for a well-formed code that found no vessel
 * (`/MXE-99999` — a genuine vessel miss).
 *
 * WHY THE COPY IS CONDITIONAL RATHER THAN SPLIT
 *
 * A not-found boundary receives no params, and `headers()` here carries no
 * path (probed in dev: host, user-agent and x-forwarded-* only). The one
 * way to read the path is `usePathname()`, which needs a client component —
 * that was tried first and reverted, because it returns nothing during the
 * server render: the SSR HTML came back with the generic wording and only
 * flipped to the vessel wording after hydration. Curl, a crawler, or a slow
 * connection would see the wrong message, and everyone else would see it
 * change under them. Keep this a server component.
 *
 * So this says what is true of both, and offers the vessel case as a
 * condition the reader can check rather than a fact asserted at them. The
 * full split needs middleware to put the pathname in a request header,
 * which touches the Supabase session refresh — on the roadmap rather than
 * done in passing.
 */
export default function VesselNotFound() {
  return (
    <StatusScreen
      title="Not"
      accent="found."
      body="Nothing matches this address. If you were looking for a vessel, that code does not exist or its profile is not published yet — codes look like MXE-01024, printed on the badge."
    />
  );
}
