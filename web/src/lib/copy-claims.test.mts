import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * CLAUDE.md: copy never promises what doesn't exist. Two such claims shipped
 * and were removed 2026-09-25:
 *  - "Unlimited documents": documents are four fixed slots on every plan.
 *  - "Email reminders": the expiry reminder has a template and no sender.
 * This fails if either phrase comes back in anything users see.
 */
const SRC = new URL("../", import.meta.url).pathname;

function userFacingFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(e)) out.push(full);
    }
  };
  walk(join(SRC, "app"));
  walk(join(SRC, "components"));
  return out;
}

const stripComments = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

test("no page or component claims unlimited documents or email reminders", () => {
  const offenders: string[] = [];
  for (const file of userFacingFiles()) {
    const text = stripComments(readFileSync(file, "utf8")).replace(/\s+/g, " ");
    for (const claim of [/unlimited\s+documents/i, /Unlimited†/, /email reminders?/i, /reminders? before/i]) {
      if (claim.test(text)) offenders.push(`${file.slice(SRC.length)}: ${claim}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the FAQ doesn't say a share link opens documents", () => {
  const faq = readFileSync(join(SRC, "components/marketing/MoxieFaq.tsx"), "utf8");
  const answer = faq.slice(faq.indexOf('id="share-documents"'), faq.indexOf("</Question>", faq.indexOf('id="share-documents"')));
  assert.match(answer, /can&apos;t be opened from a share link/);
  assert.doesNotMatch(answer, />\s*Yes,/, "the old answer opened with an unqualified yes");
});

test("/login offers email sign-in only, with no setup instructions", () => {
  const src = stripComments(readFileSync(join(SRC, "app/login/LoginForm.tsx"), "utf8"));
  const login = src.slice(src.indexOf("  return (")); // the rendered page, not the client calls above it
  assert.doesNotMatch(login, /Google|Apple|Supabase|auth\/callback|URL Configuration|Or email/, "a provider that isn't on, or developer setup text");
  assert.doesNotMatch(login, /<OAuthButtons/);
});

test("/signup offers email sign-up only, with no setup instructions", () => {
  const src = stripComments(readFileSync(join(SRC, "app/signup/SignupForm.tsx"), "utf8"));
  const page = src.slice(src.indexOf("  if (done) {"));
  assert.doesNotMatch(page, /Google|Apple|Supabase|confirmations are\s+disabled|Or email/);
  assert.doesNotMatch(page, /<OAuthButtons/);
});

test("the seller is told the registration document carries, in the panel and the FAQ", () => {
  const line = "Your registration document goes to the buyer and may show your name and address, as it would in any boat sale.";
  for (const rel of ["components/vessel-edit/TransferOwnershipPanel.tsx", "components/marketing/MoxieFaq.tsx"]) {
    const text = readFileSync(join(SRC, rel), "utf8").replace(/\s+/g, " ");
    assert.ok(text.includes(line), `${rel} is missing the registration carry-over note`);
  }
  const faq = readFileSync(join(SRC, "components/marketing/MoxieFaq.tsx"), "utf8");
  const carries = faq.indexOf("Carries to the buyer:");
  assert.ok(carries > 0 && faq.indexOf("may show your name and address", carries) < faq.indexOf("Stays with you:", carries), "the note sits under Carries to the buyer");
});
