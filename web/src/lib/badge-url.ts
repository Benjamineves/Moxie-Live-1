/**
 * The URL a badge's QR actually encodes (spec §1.4, §1.7).
 *
 * `/s/<token>` rather than `/<mxeId>?scan=1`, and the difference is the
 * whole reason a token fits at all. `?scan=1` costs 7 characters purely
 * to signal "this arrival is a physical scan" — a signal a route only
 * printed badges ever point at carries by existing. Dropping it plus the
 * `MXE-` prefix frees 12 characters, more than a 9-character token
 * costs, which is what buys version 4 (1.277 mm modules) where appending
 * a token to the old URL would have forced version 6 (1.050 mm).
 *
 * That budget is tight on purpose: 34 characters is exactly the version
 * 4 ceiling at ECC level H. Lengthening anything here — a `www.`, a
 * longer domain, a tenth token character — degrades to version 5, which
 * is what badges already printed are and is still inside the print spec.
 * It is a graceful step down, not a break, but it should be a decision
 * rather than a surprise, which is what assertBadgeQrVersionWithinBudget
 * is for.
 */
import { BADGE_TOKEN_LENGTH } from "./badge-token";

/**
 * Same resolution the existing badge render uses, so both URL schemes
 * agree about which origin a badge points at. Already-printed badges
 * encode moxieyacht.com and that origin must keep resolving forever
 * (§1.5, §6 rows 1 and 4).
 */
export function badgeBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_BASE_URL?.trim() || "https://moxieyacht.com").replace(/\/$/, "");
}

export function badgeScanUrl(token: string): string {
  return `${badgeBaseUrl()}/s/${token}`;
}

/**
 * A same-length stand-in used to measure QR density before any real
 * token exists — which is what lets badge_print_batches.qr_version be
 * NOT NULL and recorded at step 1 of the mint, before tokens are even
 * inserted.
 *
 * This works only because tokens are fixed-length: every identity in a
 * batch encodes a URL of identical length and therefore an identical QR
 * version, so the version is one fact about the batch rather than an
 * average of a hundred (§5.0.5). The `0` fill is arbitrary — only the
 * character count is being measured.
 */
export function badgeScanUrlProbe(): string {
  return badgeScanUrl("0".repeat(BADGE_TOKEN_LENGTH));
}
