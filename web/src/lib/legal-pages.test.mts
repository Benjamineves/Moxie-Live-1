import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * /terms and /privacy exist ahead of the attorney-reviewed text: noindex,
 * reachable on both domains, and linked from nowhere. When the text lands
 * and they're meant to be found, change the robots setting and delete the
 * "linked from nowhere" test deliberately.
 */
const SRC = new URL("../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("both pages are noindex, nofollow", () => {
  for (const rel of ["app/terms/page.tsx", "app/privacy/page.tsx"]) {
    assert.match(read(rel), /robots:\s*\{\s*index:\s*false,\s*follow:\s*false\s*\}/, rel);
  }
});

test("both render on the marketing domain too", () => {
  assert.match(read("middleware.ts"), /MARKETING_PATHS = new Set\(\[[^\]]*"\/terms"[^\]]*"\/privacy"/);
});

test("nothing links to them yet", () => {
  const hits: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e) && !/\.test\.mts$/.test(e) && /["'`/](terms|privacy)["'`?#]/.test(readFileSync(full, "utf8").replace(/"\/(terms|privacy)"\]?/g, (m) => (full.endsWith("middleware.ts") ? "" : m)))) {
        hits.push(full.slice(SRC.length));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
});
