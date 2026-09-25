import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { checkStorageZip, normalizeZip, storagePatchForSave } from "./storage-zip.ts";
import { filterVesselForShare, type ShareFieldFlags } from "./share-filter.ts";

const SRC = new URL("../", import.meta.url).pathname;
const read = (rel: string) => readFileSync(join(SRC, rel), "utf8");

test("known ZIPs resolve to their county within the chosen state", () => {
  assert.deepEqual(checkStorageZip("94965", "CA"), { ok: true, zip: "94965", county: "Marin County" });
  assert.deepEqual(checkStorageZip(" 94501-1234 ", "ca"), { ok: true, zip: "94501", county: "Alameda County" });
  assert.deepEqual(checkStorageZip("33477", "FL"), { ok: true, zip: "33477", county: "Palm Beach County" });
  assert.deepEqual(checkStorageZip("98101", "WA"), { ok: true, zip: "98101", county: "King County" });
});

test("a ZIP that crosses a state line takes the county on the chosen side", () => {
  // 19973 spans Delaware and Maryland in the Census file.
  assert.deepEqual(checkStorageZip("19973", "DE"), { ok: true, zip: "19973", county: "Sussex County" });
  assert.deepEqual(checkStorageZip("19973", "MD"), { ok: true, zip: "19973", county: "Dorchester County" });
});

test("wrong state, unknown ZIP, bad format and missing state are refused with a message", () => {
  const wrong = checkStorageZip("94965", "FL");
  assert.equal(wrong.ok, false);
  assert.match(!wrong.ok ? wrong.error : "", /in California, not Florida/);
  assert.equal(checkStorageZip("00000", "CA").ok, false);
  for (const z of ["9496", "949655", "abcde", "", null, 94965]) assert.equal(checkStorageZip(z, "CA").ok, false, String(z));
  assert.equal(checkStorageZip("94965", "").ok, false);
  assert.equal(normalizeZip("94965-12"), null);
});

test("a Storage save needs a valid ZIP; other sections are untouched", () => {
  assert.deepEqual(storagePatchForSave({ owner_phone: "555" }, null), { ok: true, set: {} });
  assert.equal(storagePatchForSave({ storage_type: "marina", storage_state: "CA" }, null).ok, false, "no ZIP");
  assert.equal(storagePatchForSave({ storage_state: "FL", storage_zip: "94965" }, null).ok, false, "ZIP outside the new state");
  assert.deepEqual(storagePatchForSave({ storage_city: "Sausalito", storage_zip: "94965" }, "CA"), {
    ok: true,
    set: { storage_zip: "94965", storage_county: "Marin County" },
  }, "falls back to the stored state");
  const spoofed = storagePatchForSave({ storage_state: "CA", storage_zip: "94965", storage_county: "Made Up County" }, null);
  assert.deepEqual(spoofed, { ok: true, set: { storage_zip: "94965", storage_county: "Marin County" } }, "client county ignored");
});

// The shipped write paths must use the check. Both fail against the code
// before Stage 1, which wrote no ZIP at all.
test("registration validates the ZIP and writes only the derived county", () => {
  const src = read("app/dashboard/new/actions.ts");
  const body = src.slice(src.indexOf("export async function createVessel("));
  const check = body.search(/checkStorageZip\(input\.storage_zip, input\.storage_state\)/);
  const write = body.search(/rpc\("create_vessel_with_badge"/);
  assert.ok(check > 0 && check < write, "createVessel must check the ZIP before inserting");
  assert.match(body, /storage_zip: zipCheck\.zip,\s*storage_county: zipCheck\.county,/);
});

test("the Storage section save requires the ZIP and derives the county server-side", () => {
  const src = read("lib/owner-actions.ts");
  const fields = src.slice(src.indexOf("const OWNER_FIELDS = ["), src.indexOf("] as const", src.indexOf("const OWNER_FIELDS = [")));
  assert.match(fields, /"storage_zip"/);
  assert.doesNotMatch(fields, /storage_county/, "a client must never set the county");
  const body = src.slice(src.indexOf("export async function updateVesselOwnerFields("));
  const check = body.search(/storagePatchForSave\(update, storedState\)/);
  const write = body.search(/\.from\("vessels"\)\.update\(update\)/);
  assert.ok(check > 0 && check < write, "updateVesselOwnerFields must apply storagePatchForSave before writing");
});

test("ZIP and county never reach the public profile", () => {
  const src = read("lib/vessel-service.ts");
  const base = src.slice(src.indexOf("const basePublic = {"), src.indexOf("};", src.indexOf("const basePublic = {")));
  assert.ok(base.length > 50, "basePublic not found");
  assert.doesNotMatch(base, /storage_zip|storage_county/);
});

test("share links carry city and state in the location group, never ZIP or county", () => {
  const vessel = {
    mxe_id: "MXE-00001", vessel_name: "V", vessel_type: "Sailboat", make: "M", model: "X", year: 2020,
    length_ft: 30, draft_ft: null, engine: null, public_notes: null, photo_url: null,
    storage_type: "marina", storage_description: null, storage_city: "Sausalito", storage_state: "CA",
    storage_zip: "94965", storage_county: "Marin County", marina_name: "Harbor", marina_city: null,
  } as unknown as Parameters<typeof filterVesselForShare>[0];
  const all: ShareFieldFlags = { location: true, contact: true, docs: true, ownership: true, access: true, service: true };
  const out = filterVesselForShare(vessel, all, null) as Record<string, unknown>;
  assert.equal(out.storage_city, "Sausalito");
  assert.equal(out.storage_state, "CA");
  assert.ok(!("storage_zip" in out) && !("storage_county" in out));
  const none = filterVesselForShare(vessel, { ...all, location: false }, null) as Record<string, unknown>;
  assert.ok(!("storage_city" in none), "city is part of the location group");
});

test("transfer clears the ZIP and county with the other storage fields", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/20261014_storage_zip_county.sql", import.meta.url), "utf8");
  const start = sql.indexOf("UPDATE vessels SET");
  const update = sql.slice(start, sql.indexOf("WHERE id = t.vessel_id;", start));
  assert.match(update, /storage_state = NULL/);
  assert.match(update, /storage_zip = NULL, storage_county = NULL/);
});

test("the 0.9 MB lookup is imported only by the server-side module", () => {
  const importers: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(e) && /zip-county-data/.test(readFileSync(full, "utf8")) && !full.endsWith("zip-county-data.ts")) {
        importers.push(full.slice(SRC.length));
      }
    }
  };
  walk(SRC);
  assert.deepEqual(importers, ["lib/storage-zip.ts"]);
  const clientImporters: string[] = [];
  const walk2 = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk2(full);
      else if (/\.tsx?$/.test(e)) {
        const s = readFileSync(full, "utf8");
        if (/^["']use client["']/.test(s) && /storage-zip["']/.test(s)) clientImporters.push(full.slice(SRC.length));
      }
    }
  };
  walk2(SRC);
  assert.deepEqual(clientImporters, [], "a client component imports the ZIP lookup");
});
