import { NotFoundView } from "@/components/NotFoundView";

/**
 * A print batch id that matched no row. Admin-only, and the reader is
 * looking at badge inventory rather than a vessel, so it names the batch.
 */
export default function BatchNotFound() {
  return (
    <NotFoundView
      title="Batch"
      accent="not found."
      body="No print batch has that id. It may have been removed, or the link may be out of date."
      href="/admin/badges"
      action="Back to badges"
    />
  );
}
