import { NotFoundView } from "@/components/NotFoundView";

/**
 * A scanned badge that resolved to nothing. Reached by every notFound() in
 * s/[token]/page.tsx — a malformed token, an unknown one, and a badge
 * whose identity is not in service — and it deliberately does not say
 * which. page.tsx's own note explains why: a "malformed token" message
 * tells a prober their guess had the wrong shape.
 *
 * Worded for someone holding a physical badge, since that is how this URL
 * is almost always reached, and not for someone who mistyped a page.
 */
export default function BadgeNotFound() {
  return (
    <NotFoundView
      title="Badge"
      accent="not recognised."
      body="This badge link does not lead to a vessel. If you scanned a Moxie badge, it may have been retired — the owner can confirm."
    />
  );
}
