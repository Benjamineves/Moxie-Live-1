import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isOwnPhotoUrl, isOwnStoragePath } from "./storage-path.ts";

const ME = "90806ee6-7f4d-4f17-aa7a-894e9fdb07d1";
const OTHER = "b6cac9fa-c544-4fb5-a6ed-13490e429a0e";
const SUPA = "https://proj.supabase.co";

test("paths the upload helpers actually produce are accepted", () => {
  for (const p of [
    `${ME}/MXE-01015/insurance.pdf`,
    `${ME}/intake-3f2a9c1e-0000-4000-8000-000000000000/registration.jpg`,
    `${ME}/MXE-01015/service-records/mf3k2a.pdf`,
    `${ME}/MXE-01015/correction-requests/mf3k2a.png`,
    `${ME}/MXE-01015/registration.my scan`, // extFor() on a dotless filename
  ]) {
    assert.equal(isOwnStoragePath(p, ME), true, p);
  }
});

test("another owner's folder, traversal and malformed paths are refused", () => {
  for (const p of [
    `${OTHER}/MXE-01016/insurance.pdf`,
    `${ME}/../${OTHER}/MXE-01016/insurance.pdf`,
    `${ME}/./insurance.pdf`,
    `${ME}/%2e%2e/${OTHER}/insurance.pdf`,
    `${ME}\\..\\${OTHER}/insurance.pdf`,
    `/${ME}/MXE-01015/insurance.pdf`,
    `${ME}//insurance.pdf`,
    `${ME}`,
    `${ME}-suffix/MXE-01015/insurance.pdf`,
    "",
    null,
    42,
  ]) {
    assert.equal(isOwnStoragePath(p, ME), false, String(p));
  }
  assert.equal(isOwnStoragePath(`${ME}/x.pdf`, ""), false, "no user id, no pass");
});

test("photo URLs: only our public vessel-photos URL in the caller's folder", () => {
  const own = `${SUPA}/storage/v1/object/public/vessel-photos/${ME}/MXE-01015/photo`;
  assert.equal(isOwnPhotoUrl(own, ME, SUPA), true);
  assert.equal(isOwnPhotoUrl(`${own}?v=mf3k2a`, ME, SUPA), true);
  for (const u of [
    `${SUPA}/storage/v1/object/public/vessel-photos/${OTHER}/MXE-01016/photo`,
    `https://evil.example/storage/v1/object/public/vessel-photos/${ME}/MXE-01015/photo`,
    `${SUPA}/storage/v1/object/public/vessel-docs/${ME}/MXE-01015/insurance.pdf`,
    `${SUPA}/storage/v1/object/sign/vessel-photos/${ME}/MXE-01015/photo?token=x`,
    `${own}?v=1&download=1`,
    `${own}#frag`,
    "not a url",
  ]) {
    assert.equal(isOwnPhotoUrl(u, ME, SUPA), false, u);
  }
  assert.equal(isOwnPhotoUrl(own, ME, undefined), false, "no configured origin, no pass");
});

// The defect: these actions stored whatever path the client sent, and the
// routes signed it with the service role. Each must check before storing.
const SRC = new URL("../", import.meta.url).pathname;
const MUST_CHECK: [string, string, RegExp][] = [
  ["lib/owner-actions.ts", "updateVesselDocument", /isOwnStoragePath\(url, user\.id\)/],
  ["lib/owner-actions.ts", "updateVesselPhoto", /isOwnPhotoUrl\(photoUrl, user\.id/],
  ["lib/owner-actions.ts", "submitIdentityCorrectionRequest", /isOwnStoragePath\(documentPath, user\.id\)/],
  ["app/dashboard/[mxeId]/service/actions.ts", "addServiceRecord", /isOwnStoragePath\(input\.file\.path, ctx\.ownerId\)/],
  ["app/dashboard/new/actions.ts", "createVessel", /isOwnStoragePath\(path\.trim\(\), user\.id\)[\s\S]*isOwnPhotoUrl\(input\.photo_url/],
];

function functionBody(src: string, name: string) {
  const start = src.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const next = src.indexOf("\nexport ", start + 1);
  return src.slice(start, next < 0 ? undefined : next);
}

test("every action that stores a client-supplied path checks it first", () => {
  for (const [file, fn, check] of MUST_CHECK) {
    const body = functionBody(readFileSync(join(SRC, file), "utf8"), fn);
    const at = body.search(check);
    assert.ok(at > 0, `${file}#${fn} stores a path without the ownership check`);
    const write = body.search(/\.(update|insert)\(|rpc\("create_vessel_with_badge"|insertServiceRecord\(/);
    assert.ok(write < 0 || at < write, `${file}#${fn} checks the path only after writing it`);
  }
});

test("no other server action stores a path column", () => {
  const known = new Set(MUST_CHECK.map(([f]) => f));
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(e) && !e.endsWith(".test.mts")) {
        const s = readFileSync(full, "utf8");
        if (!/^"use server"/.test(s)) continue;
        if (/photo_url|doc_(registration|insurance|boater_card|fishing_license)_url|document_path|file_path/.test(s)) {
          const rel = full.slice(SRC.length);
          if (!known.has(rel)) offenders.push(rel);
        }
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, [], "a new action stores a storage path — route it through lib/storage-path.ts and add it to MUST_CHECK");
});
