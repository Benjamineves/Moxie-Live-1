/**
 * Guards the path-data serializer.
 *
 * THE DEFECT THIS EXISTS FOR
 *
 * opentype's own Path.toPathData() rounds by concatenating an exponent
 * onto a stringified number. When a coordinate's fractional part is
 * small enough to print exponentially (5.68e-14, say — glyph points land
 * a hair off an integer constantly) the expression becomes
 * Math.round("5.68e-14e+2"), which is NaN, and the literal text "NaN"
 * goes into the path.
 *
 * An SVG parser stops at the first token it cannot read, so the caption
 * rendered up to the bad coordinate and then simply stopped. Six of the
 * first twenty-five badges minted shipped with a truncated scan line;
 * across a 2000-ID sweep the rate was 17%. Nothing about it was random —
 * whether a badge hit one depended on its run's starting x, which
 * depends on the total advance width, which depends on which digits are
 * in the MXE ID.
 *
 * badge-outline.ts formats coordinates itself now. These tests keep it
 * that way.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { outlineRun } from "./badge-outline.ts";
import { badgeTextRuns } from "./badge-layout.ts";

/** Everything SVG path data is allowed to contain, given what we emit. */
const VALID_PATH_TOKENS = /^[MLQCZ0-9.\-\s]*$/;

const scanLabelRun = (mxeId: string) =>
  badgeTextRuns(mxeId, 1000).find((run) => run.key === "scanLabel")!;

/**
 * The exact identities that shipped corrupted. These are not arbitrary
 * samples — each one demonstrably produced "NaN" in its scan-line path
 * and rendered as a truncated caption on a real badge. They are the
 * regression fixture, and they cost nothing to keep.
 */
const SHIPPED_CORRUPTED = [
  "MXE-01025",
  "MXE-01026",
  "MXE-01029",
  "MXE-01032",
  "MXE-01034",
  "MXE-01040",
];

test("the six MXE IDs that shipped corrupted now outline cleanly", () => {
  for (const mxeId of SHIPPED_CORRUPTED) {
    const d = outlineRun(scanLabelRun(mxeId));
    assert.ok(!d.includes("NaN"), `${mxeId} still emits NaN in its scan line`);
    assert.match(d, VALID_PATH_TOKENS, `${mxeId} emitted a token no SVG parser will accept`);
  }
});

test("no MXE ID across a wide sweep emits an invalid path token", () => {
  // At the pre-fix rate of ~17% this sweep would have failed on roughly
  // forty of these. It exists because the defect was invisible on any
  // single badge you happened to look at.
  const offenders: string[] = [];
  for (let n = 1; n <= 250; n += 1) {
    const mxeId = `MXE-${String(n).padStart(5, "0")}`;
    const d = outlineRun(scanLabelRun(mxeId));
    if (!VALID_PATH_TOKENS.test(d)) offenders.push(mxeId);
  }
  assert.deepEqual(offenders, [], `${offenders.length} of 250 MXE IDs emitted invalid path data`);
});

test("every emitted number is finite and in plain decimal notation", () => {
  const d = outlineRun(scanLabelRun("MXE-01040"));
  const numbers = d.match(/-?\d+(?:\.\d+)?/g) ?? [];
  assert.ok(numbers.length > 100, "expected a substantial number of coordinates");
  for (const raw of numbers) {
    assert.ok(Number.isFinite(Number(raw)), `"${raw}" is not a finite number`);
  }
  assert.ok(!/e[+-]/i.test(d), "exponential notation reached the path — the original defect's mechanism");
});

test("a non-finite coordinate throws rather than reaching Storage", () => {
  // The backstop. Whatever produces it, a coordinate that is not a real
  // number must stop the render, not be serialized into artwork that
  // uploads and looks fine until someone reads the caption.
  assert.throws(
    () => outlineRun({ ...scanLabelRun("MXE-01040"), fontSize: Number.NaN }),
    /non-finite coordinate/,
  );
});

test("outlining is deterministic", () => {
  // The failing set never changed between runs, which is what ruled out
  // concurrency and shared state as the cause. Keep that property: it is
  // what makes a corrupted badge reproducible from its MXE ID alone.
  const once = outlineRun(scanLabelRun("MXE-01040"));
  const twice = outlineRun(scanLabelRun("MXE-01040"));
  assert.equal(once, twice);
});
