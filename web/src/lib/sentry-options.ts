/**
 * Shared Sentry settings for the browser, Node and edge runtimes.
 *
 * Errors only, and inert until a DSN is set: with NEXT_PUBLIC_SENTRY_DSN
 * empty, `enabled` is false and nothing is sent anywhere (the default for
 * local dev and until Ben creates the Sentry project).
 *
 * Deliberately NOT on:
 *  - tracing (tracesSampleRate 0): the free tier's quota is for errors;
 *  - Session Replay: it would record owners' screens — documents, contacts,
 *    mailing addresses;
 *  - sendDefaultPii — but that alone was NOT enough. Checked 2026-09-25
 *    against a local stand-in DSN: with it false, a server event still
 *    carried non-auth cookie values, the x-forwarded-for header and
 *    user.ip_address (the visitor's IP). scrubEvent below removes all three,
 *    on every event, before it leaves.
 * What reaches Sentry: the error, its stack, the URL, method, user-agent. An
 * error MESSAGE that embeds a value (e.g. "vessels read failed: …") travels
 * with it.
 */

type ScrubbableEvent = {
  request?: { cookies?: unknown; headers?: Record<string, string>; data?: unknown };
  user?: { ip_address?: unknown } & Record<string, unknown>;
};

const DROP_HEADERS = ["cookie", "x-forwarded-for", "x-real-ip", "x-vercel-forwarded-for", "cf-connecting-ip", "true-client-ip", "forwarded", "authorization"];

/** Removes cookies, IP-bearing headers, request bodies and the user IP. */
export function scrubEvent<E extends ScrubbableEvent>(event: E): E {
  if (event.request) {
    delete event.request.cookies;
    delete event.request.data;
    if (event.request.headers) {
      for (const key of Object.keys(event.request.headers)) {
        if (DROP_HEADERS.includes(key.toLowerCase())) delete event.request.headers[key];
      }
    }
  }
  if (event.user) {
    delete event.user.ip_address;
    if (Object.keys(event.user).length === 0) delete event.user;
  }
  return event;
}
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;

export const SENTRY_OPTIONS = {
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? process.env.VERCEL_ENV ?? "development",
  tracesSampleRate: 0,
  sendDefaultPii: false,
  beforeSend: scrubEvent,
};
