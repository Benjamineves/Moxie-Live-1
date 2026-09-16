import { NotFoundView } from "@/components/NotFoundView";

/**
 * The app-wide 404: every unmatched URL in the app renders this, whatever
 * it was about. So it says nothing about vessels — most things reaching it
 * are not one. A route that never existed (`/dashboard/<mxeId>`), a
 * mistyped marketing path, a stale link: all of them land here, and being
 * told a vessel code was wrong sent at least one debugging session looking
 * at the database instead of the routes.
 *
 * The cases that DO know what failed have their own boundary next to the
 * code that calls notFound(): app/[mxeId], app/s/[token] and
 * app/admin/badges/[batchId].
 */
export default function NotFound() {
  return (
    <NotFoundView
      title="Page"
      accent="not found."
      body="The address may have a typo, or the link may be out of date. Nothing is wrong with your account."
    />
  );
}
