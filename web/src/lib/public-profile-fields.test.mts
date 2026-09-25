import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

/**
 * A stranger scanning a badge sees the storage TYPE and city/state — never
 * which marina, the legacy marina city string, or the owner's free-text
 * storage description (owner-only since 2026-09-25). Share links are
 * separate and unchanged: the owner chooses to include the marina there.
 */
const read = (rel: string) =>
  readFileSync(new URL(`../${rel}`, import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const HIDDEN = /marina_name|marina_city|storage_description|storage_zip|storage_county/;

test("the public allow-list carries no marina field, storage description, ZIP or county", () => {
  const src = read("lib/vessel-service.ts");
  const start = src.indexOf("const basePublic = {");
  const base = src.slice(start, src.indexOf("};", start));
  assert.ok(base.includes("storage_city") && base.includes("storage_state") && base.includes("storage_type"), "city/state/type stay public");
  assert.doesNotMatch(base, HIDDEN);
});

test("the owner still gets them, from the owner block", () => {
  const src = read("lib/vessel-service.ts");
  const owner = src.slice(src.indexOf('if (role === "owner")'));
  for (const f of ["storage_description", "marina_name", "marina_city"]) assert.match(owner, new RegExp(f), f);
});

test("the public profile component can't render them, and has no marina_city fallback", () => {
  const src = read("components/VesselPublicProfile.tsx");
  assert.doesNotMatch(src, HIDDEN);
});

test("copy matches: owner note says so; the intake hint no longer promises the marina is public", () => {
  const owner = read("components/VesselOwnerProfile.tsx").replace(/\s+/g, " ");
  assert.ok(owner.includes("Only you can see your marina and storage details. Your public profile shows city and state only."));
  assert.doesNotMatch(owner, /home marina is shown on your public profile/i);
  assert.doesNotMatch(read("app/dashboard/new/VesselIntakeForm.tsx"), /Appears on your public profile/);
});
