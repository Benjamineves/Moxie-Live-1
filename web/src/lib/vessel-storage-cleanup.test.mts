/**
 * Recovering a Storage key from a stored photo URL.
 *
 * This is the fiddly half of the reclaim's cleanup. photo_url is a full
 * public URL with a cache-bust token rather than a path, so the key has
 * to be parsed back out — and getting it wrong means either a photo left
 * behind after its vessel is deleted, or, worse, a remove() call aimed
 * at the wrong key.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { photoObjectPath } from "./vessel-storage-cleanup.ts";

const BASE = "https://imhoeviehenluccjgnru.supabase.co/storage/v1/object/public/vessel-photos";

test("recovers the key from a tokenized public URL", () => {
  // What uploadVesselPhoto actually stores: extensionless path plus ?v=.
  assert.equal(
    photoObjectPath(`${BASE}/90806ee6-7f4d-4f17-aa7a-894e9fdb07d1/MXE-01023/photo?v=m7x2k`),
    "90806ee6-7f4d-4f17-aa7a-894e9fdb07d1/MXE-01023/photo",
  );
});

test("recovers the key from an intake draft folder", () => {
  // Since stage 7a, intake uploads land under a draft key rather than an
  // MXE ID — the reclaim has to cope with both, and a real abandoned
  // checkout is always the draft shape.
  assert.equal(
    photoObjectPath(`${BASE}/90806ee6-7f4d-4f17-aa7a-894e9fdb07d1/intake-8f14e45f/photo?v=abc`),
    "90806ee6-7f4d-4f17-aa7a-894e9fdb07d1/intake-8f14e45f/photo",
  );
});

test("copes with a URL carrying no cache-bust token", () => {
  // Rows written before the token was introduced.
  assert.equal(photoObjectPath(`${BASE}/user/MXE-00001/photo`), "user/MXE-00001/photo");
});

test("decodes percent-encoding", () => {
  assert.equal(photoObjectPath(`${BASE}/user/my%20folder/photo?v=1`), "user/my folder/photo");
});

test("returns null rather than guessing", () => {
  // A null here is reported to the admin as "could not derive object
  // path" rather than silently skipped, because it means a file is being
  // left behind and someone has to go and find it.
  assert.equal(photoObjectPath(null), null);
  assert.equal(photoObjectPath(""), null);
  assert.equal(photoObjectPath("https://example.com/some/other/thing.png"), null);
});

test("does not match a different bucket", () => {
  // vessel-docs paths must never be handed to the photos bucket.
  assert.equal(
    photoObjectPath("https://x.supabase.co/storage/v1/object/public/vessel-docs/u/MXE-1/registration.pdf"),
    null,
  );
});
