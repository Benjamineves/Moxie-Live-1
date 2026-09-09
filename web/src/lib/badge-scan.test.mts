/**
 * Every outcome a badge scan can produce.
 *
 * These exist because the live route could only exercise one of them.
 * When stage 5 was built every minted identity was still `minted`, so
 * `assigned`, `void` and the 404 path had no real row to test against —
 * and the entry point to this code is a QR glued to a boat, where an
 * unverified branch is not a bug you push a fix for.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveBadgeScan } from "./badge-scan.ts";

const identity = (status: string, vesselMxeId: string | null = null) => ({
  status,
  mxe_id: "MXE-01042",
  vesselMxeId,
});

test("an assigned badge redirects to its vessel", () => {
  assert.deepEqual(resolveBadgeScan(identity("assigned", "MXE-01042")), {
    kind: "redirect",
    mxeId: "MXE-01042",
  });
});

test("the redirect follows the vessel, not the identity", () => {
  // They match by construction, but /<mxeId> resolves the vessel row and
  // apply_vessel_identity_correction can move it. The badge must follow
  // the boat.
  assert.deepEqual(resolveBadgeScan(identity("assigned", "MXE-09999")), {
    kind: "redirect",
    mxeId: "MXE-09999",
  });
});

test("an assigned badge with no vessel join still goes somewhere real", () => {
  // A badge on a hull must not 404 because a join came back empty.
  assert.deepEqual(resolveBadgeScan(identity("assigned", null)), {
    kind: "redirect",
    mxeId: "MXE-01042",
  });
});

test("a void badge renders, it does not 404", () => {
  assert.deepEqual(resolveBadgeScan(identity("void")), { kind: "notice", reason: "void" });
});

test("every pre-assignment state renders as unregistered", () => {
  // §1.7 names in_stock. minted and printed are the states a badge holds
  // while it is being produced, and one scanned on a packing line is as
  // real and as unregistered as one on a warehouse shelf. A 404 on a
  // physical product reads as a broken product.
  for (const status of ["minted", "printed", "in_stock"]) {
    assert.deepEqual(
      resolveBadgeScan(identity(status)),
      { kind: "notice", reason: "unregistered" },
      `${status} should render the unregistered notice`,
    );
  }
});

test("an unknown token is the only thing that 404s", () => {
  assert.deepEqual(resolveBadgeScan(null), { kind: "notFound" });
});

test("an unrecognised status degrades to the calmest true statement", () => {
  // If a later migration adds a status this code has not heard of, the
  // person holding the badge should not get a 500.
  assert.deepEqual(resolveBadgeScan(identity("some_future_status")), {
    kind: "notice",
    reason: "unregistered",
  });
});

test("no outcome other than notFound can produce a 404", () => {
  // The property §1.7 actually cares about, asserted directly rather
  // than inferred from the cases above.
  const everyStatus = ["minted", "printed", "in_stock", "assigned", "void", "anything_else"];
  for (const status of everyStatus) {
    const outcome = resolveBadgeScan(identity(status, "MXE-01042"));
    assert.notEqual(outcome.kind, "notFound", `a real badge in status ${status} must never 404`);
  }
});
