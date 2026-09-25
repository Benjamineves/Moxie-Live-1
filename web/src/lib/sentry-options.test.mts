import { test } from "node:test";
import assert from "node:assert/strict";
import { SENTRY_OPTIONS, scrubEvent } from "./sentry-options.ts";

// Shape recorded from a real server event against a local stand-in DSN,
// 2026-09-25, with sendDefaultPii: false.
const captured = () => ({
  request: {
    method: "GET",
    url: "https://moxieyacht.com/dashboard",
    headers: {
      host: "moxieyacht.com",
      "user-agent": "Mozilla/5.0",
      cookie: "[Filtered]",
      "x-forwarded-for": "203.0.113.7",
      "X-Real-IP": "203.0.113.7",
      authorization: "Bearer abc",
    },
    cookies: { "sb-x-auth-token": "[Filtered]", other: "1" },
    data: "email=someone@example.com",
  },
  user: { ip_address: "203.0.113.7" },
});

test("cookies, IP headers, request bodies and the user IP never leave", () => {
  const e = scrubEvent(captured());
  assert.equal(e.request.cookies, undefined);
  assert.equal(e.request.data, undefined);
  assert.deepEqual(Object.keys(e.request.headers).sort(), ["host", "user-agent"]);
  assert.equal(e.user, undefined, "an emptied user object is dropped");
  assert.equal(e.request.url, "https://moxieyacht.com/dashboard", "the URL stays — it's what makes an error findable");
});

test("a user id set deliberately survives; only the IP goes", () => {
  const e = scrubEvent({ user: { id: "u-1", ip_address: "203.0.113.7" } });
  assert.deepEqual(e.user, { id: "u-1" });
});

test("inert without a DSN, errors only, scrubber wired in", () => {
  assert.equal(SENTRY_OPTIONS.enabled, !!process.env.NEXT_PUBLIC_SENTRY_DSN?.trim());
  assert.equal(SENTRY_OPTIONS.tracesSampleRate, 0);
  assert.equal(SENTRY_OPTIONS.sendDefaultPii, false);
  assert.equal(SENTRY_OPTIONS.beforeSend, scrubEvent);
});
