import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { safeNextPath } from "./safe-next.ts";

test("same-site paths survive, including query and hash", () => {
  assert.equal(safeNextPath("/dashboard"), "/dashboard");
  assert.equal(safeNextPath("/transfer/accept?token=abc&accepted=1"), "/transfer/accept?token=abc&accepted=1");
  assert.equal(safeNextPath("/marina/join?code=ABCD-1234"), "/marina/join?code=ABCD-1234");
  assert.equal(safeNextPath("/reset-password"), "/reset-password");
});

test("anything that could leave the site falls back", () => {
  const BS = "\\";
  for (const raw of [
    "//evil.example",
    `/${BS}evil.example`,
    `/${BS}/evil.example`,
    `${BS}${BS}evil.example`,
    "https://evil.example",
    "evil.example",
    "javascript:alert(1)",
    "/\tevil",
    "/\n/evil.example",
    "",
    undefined,
    null,
    ["/dashboard"],
  ]) {
    assert.equal(safeNextPath(raw), "/dashboard", JSON.stringify(raw));
  }
  assert.equal(safeNextPath("//evil.example", "/login"), "/login", "caller's fallback is used");
});

test("the result always resolves to our own origin", () => {
  for (const raw of ["/a/../../b", "/%2F%2Fevil.example", "/%5Cevil.example", "/.//evil.example"]) {
    const out = safeNextPath(raw);
    assert.equal(new URL(out, "https://moxieyacht.com").origin, "https://moxieyacht.com", `${raw} -> ${out}`);
  }
});

// The defect: /login and /signup took any `next` starting with "/", and the
// callback's "not //" check let a backslash through. Every entry point must
// use the shared check.
test("every sign-in entry point uses safeNextPath", () => {
  const src = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
  for (const rel of ["app/login/page.tsx", "app/signup/page.tsx", "app/login/LoginForm.tsx", "app/auth/callback/route.ts", "components/auth/OAuthButtons.tsx"]) {
    assert.match(src(rel), /safeNextPath\(/, rel);
    assert.doesNotMatch(src(rel), /\.startsWith\("\/"\)\s*\?/, `${rel} still has its own startsWith check`);
  }
});

test("no OAuth button is shown for a provider that isn't enabled", () => {
  const src = readFileSync(new URL("../components/auth/OAuthButtons.tsx", import.meta.url), "utf8");
  assert.match(src, /const APPLE_OAUTH_ENABLED = false;/);
  assert.match(src, /\{APPLE_OAUTH_ENABLED \? \(/);
});
