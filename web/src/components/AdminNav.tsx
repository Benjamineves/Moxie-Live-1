import Link from "next/link";

const LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/admin/stickers", label: "Sticker fulfillment" },
  { href: "/admin/vessel-identity-log", label: "Identity change log" },
  { href: "/admin/vessel-correction-requests", label: "Correction requests" },
] as const;

/**
 * Consistent header across every admin page — links to the owner
 * dashboard plus the other admin pages, so navigation is symmetric in
 * both directions (previously the three admin pages linked to each
 * other but none linked back to /dashboard).
 */
export function AdminNav({ current }: { current: (typeof LINKS)[number]["href"] }) {
  return (
    <nav className="mb-6 flex flex-wrap gap-x-5 gap-y-2 border-b border-[var(--divider)] pb-4">
      {LINKS.map((link) =>
        link.href === current ? (
          <span
            key={link.href}
            className="font-[family-name:var(--font-dm)] text-xs font-semibold text-[var(--navy)]"
          >
            {link.label}
          </span>
        ) : (
          <Link
            key={link.href}
            href={link.href}
            className="font-[family-name:var(--font-dm)] text-xs text-[var(--blue-fg)] underline"
          >
            {link.label}
          </Link>
        ),
      )}
    </nav>
  );
}
