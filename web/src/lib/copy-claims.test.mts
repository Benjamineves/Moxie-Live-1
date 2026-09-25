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
