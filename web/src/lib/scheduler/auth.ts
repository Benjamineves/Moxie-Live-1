import { timingSafeEqual } from "node:crypto";

/**
 * Whether a request carries Vercel's cron authorization (spec §4). Vercel
 * sends `Authorization: Bearer <CRON_SECRET>`. Nothing else about the
 * request — user agent, x-vercel-cron-schedule — is evidence; anyone can
 * send those.
 *
 * "unconfigured" when CRON_SECRET is unset or blank: the route refuses to
 * run rather than treating a missing secret as no check.
 */
export function checkCronAuthorization(
  authorizationHeader: string | null | undefined,
  secret: string | null | undefined,
): "ok" | "unauthorized" | "unconfigured" {
  const expected = secret?.trim();
  if (!expected) return "unconfigured";
  if (!authorizationHeader) return "unauthorized";
  const a = Buffer.from(authorizationHeader, "utf8");
  const b = Buffer.from(`Bearer ${expected}`, "utf8");
  // timingSafeEqual throws on unequal lengths; the length itself isn't secret.
  if (a.length !== b.length) return "unauthorized";
  return timingSafeEqual(a, b) ? "ok" : "unauthorized";
}
