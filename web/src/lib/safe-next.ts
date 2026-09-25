/**
 * The one check for a post-sign-in `next` destination. Used by /login,
 * /signup, /auth/callback and the OAuth buttons — anything that sends a
 * visitor on to a URL they supplied.
 *
 * "Starts with / and not //" is not enough: browsers and the WHATWG URL
 * parser treat `\` as `/`, so `/\evil.example` resolves to
 * https://evil.example/. Instead this resolves the value against a
 * placeholder origin and keeps it only if it stayed on that origin, then
 * returns the path it resolved to (never the raw string).
 */
const PLACEHOLDER = "https://moxie.invalid";

export function safeNextPath(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let resolved: URL;
  try {
    resolved = new URL(raw, PLACEHOLDER);
  } catch {
    return fallback;
  }
  if (resolved.origin !== PLACEHOLDER) return fallback;
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
  return path.startsWith("//") ? fallback : path;
}
