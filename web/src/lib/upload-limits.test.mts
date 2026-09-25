import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { DOCUMENT_MIME_TYPES, MAX_UPLOAD_BYTES, PHOTO_MIME_TYPES, uploadRefusal } from "./upload-limits.ts";

const SRC = new URL("../", import.meta.url).pathname;
const MIGRATION = new URL("../../../supabase/migrations/20261012_storage_bucket_limits_and_photo_policies.sql", import.meta.url);

function bucketLimits(sql: string, bucket: string) {
  const m = sql.match(
    new RegExp(`SET file_size_limit = (\\d+),\\s*allowed_mime_types = ARRAY\\[([^\\]]*)\\]\\s*WHERE id = '${bucket}'`),
  );
  assert.ok(m, `no limits UPDATE for ${bucket} in the migration`);
  return { size: Number(m[1]), types: [...m[2].matchAll(/'([^']+)'/g)].map((x) => x[1]) };
}

test("the buckets enforce exactly what the app allows", () => {
  const sql = readFileSync(MIGRATION, "utf8");
  assert.deepEqual(bucketLimits(sql, "vessel-photos"), { size: MAX_UPLOAD_BYTES, types: [...PHOTO_MIME_TYPES] });
  assert.deepEqual(bucketLimits(sql, "vessel-docs"), { size: MAX_UPLOAD_BYTES, types: [...DOCUMENT_MIME_TYPES] });
});

test("SVG and other script-capable or unexpected types are refused", () => {
  for (const type of ["image/svg+xml", "text/html", "application/javascript", "image/gif", ""]) {
    assert.notEqual(uploadRefusal({ type, size: 1000 }, "photo"), null, type);
    assert.notEqual(uploadRefusal({ type, size: 1000 }, "document"), null, type);
  }
  assert.notEqual(uploadRefusal({ type: "application/pdf", size: 1000 }, "photo"), null, "a PDF is not a photo");
});

test("allowed types under the cap pass; over the cap does not", () => {
  assert.equal(uploadRefusal({ type: "image/jpeg", size: MAX_UPLOAD_BYTES }, "photo"), null);
  assert.equal(uploadRefusal({ type: "application/pdf", size: 5_000_000 }, "document"), null);
  assert.equal(uploadRefusal({ type: "image/jpeg", size: MAX_UPLOAD_BYTES + 1 }, "photo"), "Max upload size is 10MB.");
});

// The defect: every file input took `image/*`, which includes SVG, into a
// public bucket. Inputs must use the shared explicit lists.
test("no file input accepts a wildcard image type", () => {
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const e of readdirSync(dir)) {
      const full = join(dir, e);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx$/.test(e) && /accept=["'{][^>]*image\/\*/.test(readFileSync(full, "utf8"))) offenders.push(full.slice(SRC.length));
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
