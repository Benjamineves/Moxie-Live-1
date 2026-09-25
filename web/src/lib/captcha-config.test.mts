import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { captchaConfig } from "./captcha-config.ts";

test("off unless the flag is exactly 'true'", () => {
  for (const flag of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
    assert.deepEqual(captchaConfig({ flag, siteKey: "0x4AAA" }), { enabled: false }, String(flag));
  }
});

test("on reports the site key, or its absence (shown as an error, never skipped)", () => {
  assert.deepEqual(captchaConfig({ flag: "true", siteKey: " 0x4AAA " }), { enabled: true, siteKey: "0x4AAA" });
  assert.deepEqual(captchaConfig({ flag: "true", siteKey: "" }), { enabled: true, siteKey: null });
  assert.deepEqual(captchaConfig({ flag: "true" }), { enabled: true, siteKey: null });
});

// Every auth call Supabase's CAPTCHA protects must send the token and reset
// the single-use widget afterwards; a form that skipped either would break
// the moment CAPTCHA is switched on in Supabase.
const FORMS: [string, RegExp][] = [
  ["app/login/LoginForm.tsx", /signInWithPassword\(\{[\s\S]*?captchaToken: captcha\.token/],
  ["app/signup/SignupForm.tsx", /signUp\(\{[\s\S]*?captchaToken: captcha\.token/],
  ["app/forgot-password/ForgotPasswordForm.tsx", /resetPasswordForEmail\(email, \{[\s\S]*?captchaToken/],
];

test("each auth form sends the token, waits for it, and resets after each attempt", () => {
  for (const [rel, sends] of FORMS) {
    const src = readFileSync(new URL(`../${rel}`, import.meta.url), "utf8");
    assert.match(src, /useCaptcha\(\)/, `${rel} doesn't use the captcha`);
    assert.match(src, sends, `${rel} doesn't pass the token`);
    assert.match(src, /captcha\.reset\(\)/, `${rel} doesn't reset the single-use token`);
    assert.match(src, /!captcha\.ready/, `${rel} doesn't wait for a token`);
  }
});

test("no other file calls a CAPTCHA-protected auth method", () => {
  const root = new URL("../", import.meta.url).pathname;
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e) && /auth\.(signUp|signInWithPassword|signInWithOtp|resetPasswordForEmail|signInAnonymously)\(/.test(readFileSync(full, "utf8"))) {
        hits.push(full.slice(root.length));
      }
    }
  };
  walk(root);
  assert.deepEqual(hits.sort(), FORMS.map(([f]) => f).sort());
});
