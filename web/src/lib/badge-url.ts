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
// Explicit .ts extension so node:test can resolve this module at
// runtime (badge-token.test.mts imports it). Permitted by
// allowImportingTsExtensions; Next resolves it identically.
import { BADGE_TOKEN_LENGTH } from "./badge-token.ts";

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
 * A stand-in used to measure QR density before any real token exists —
 * which is what lets badge_print_batches.qr_version be NOT NULL and
 * recorded at step 1 of the mint, before tokens are even inserted.
 *
 * THE FILL CHARACTER IS NOT ARBITRARY. An earlier version used "0"
 * repeated, on the reasoning that only the character count matters. That
 * is wrong, and measurably so: QR encoders segment by character class,
 * and a run of digits encodes as a Numeric segment at ~3.33 bits per
 * character where a run containing letters encodes as Alphanumeric at
 * 5.5. Measured on this exact URL:
 *
 *   /s/000000000  ->  Byte:25 + Numeric:9        (cheaper)
 *   /s/ZZZZZZZZZ  ->  Byte:24 + Alphanumeric:10  (what real tokens cost)
 *
 * Both are version 4 today, so the digit probe currently reports the
 * right answer — by luck. It stops being lucky at the first change that
 * eats the remaining margin, and the margin is not symmetric: version 4
 * holds a 13-character digit run but only an 11-character alphanumeric
 * one. Switching to www.moxieyacht.com, or to moxieyachting.com, already
 * splits them — digits stay version 4 while every real token becomes
 * version 5. The probe would keep reporting a version no printed badge
 * in that batch actually had.
 *
 * So the fill is "Z": a character that forces the Alphanumeric mode real
 * tokens use, making this an upper bound rather than a best case. A
 * token that happens to be all digits (possible, p ~ 3e-5) encodes more
 * cheaply and can only come in at or below this version, never above —
 * which is exactly the guarantee a single batch-level qr_version needs.
 */
export function badgeScanUrlProbe(): string {
  return badgeScanUrl("Z".repeat(BADGE_TOKEN_LENGTH));
}
