/**
 * In-memory sliding-window limiter — genuinely net new, nothing existing
 * to build on (confirmed by search: no Redis/Upstash client, no
 * middleware-level throttling anywhere in this app).
 *
 * Known limitation, stated plainly: this is per-process memory. It does
 * not share state across serverless instances or survive a cold start,
 * so on a multi-instance/serverless deployment it's a soft speed bump,
 * not a hard guarantee. It's still real protection against a single
 * naive script hammering the endpoint from one connection, which is the
 * most likely real-world attempt against GET /api/share/:token — but
 * before this matters for a genuine adversary at scale, replace with a
 * shared store (Upstash Redis, or equivalent) keyed the same way.
 *
 * TODO(rate-limit): move to Upstash Redis or Vercel KV before
 * GET /api/share/:token is live to real, unauthenticated traffic — this
 * in-memory map does not survive multiple serverless instances or a
 * cold start, so it is not a real guarantee at production scale.
 */
const hits = new Map<string, number[]>();

export function checkRateLimit(key: string, { max, windowMs }: { max: number; windowMs: number }): boolean {
  const now = Date.now();
  const timestamps = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (timestamps.length >= max) {
    hits.set(key, timestamps);
    return false;
  }
  timestamps.push(now);
  hits.set(key, timestamps);
  return true;
}
