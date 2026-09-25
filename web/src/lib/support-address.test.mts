import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * The support address is support@moxieyachting.com — an alias on the admin
 * mailbox (2026-09-25). The FAQ once sent people to an address on the other
 * domain that never existed. This fails if that address comes back anywhere
 * in the repo: site copy, email templates, docs, design references.
 */
const RETIRED = ["support", "moxieyacht.com"].join("@"); // built so this file doesn't match itself
const REPO = new URL("../../../", import.meta.url).pathname;
const SKIP = new Set(["node_modules", ".next", ".git", ".vercel"]);
const TEXT = /\.(ts|tsx|mts|mjs|js|html|md|json|sql|txt|css)$/;

test("the retired support address appears nowhere", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      if (SKIP.has(e)) continue;
      const full = join(dir, e);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (TEXT.test(e) && st.size < 5_000_000 && readFileSync(full, "utf8").includes(RETIRED)) hits.push(full.slice(REPO.length));
    }
  };
  walk(REPO);
  assert.deepEqual(hits, []);
});

test("the FAQ gives the real support address", () => {
  const faq = readFileSync(new URL("../components/marketing/MoxieFaq.tsx", import.meta.url), "utf8");
  assert.ok((faq.match(/mailto:support@moxieyachting\.com/g) ?? []).length >= 2, "badge replacement and the page footer");
});
