import { test } from "node:test";
import assert from "node:assert/strict";
import { TRACKED_STATES, countyKey, regionFor, trackedState } from "./region-config.ts";
import { ZIP_COUNTY_TSV } from "./geo/zip-county-data.ts";

// Census county names per state, exactly as storage_county stores them.
const censusCounties = new Map<string, Set<string>>();
for (const line of ZIP_COUNTY_TSV.split("\n")) {
  for (const part of line.slice(line.indexOf("\t") + 1).split("|")) {
    const state = part.slice(0, 2);
    if (!censusCounties.has(state)) censusCounties.set(state, new Set());
    censusCounties.get(state)!.add(part.slice(3));
  }
}

// Rough bounding boxes, only to catch a swapped sign or a marker in the
// wrong state.
const BOUNDS: Record<string, { lat: [number, number]; lon: [number, number] }> = {
  CA: { lat: [32.5, 42.0], lon: [-124.5, -114.1] },
  FL: { lat: [24.4, 31.0], lon: [-87.7, -79.9] },
  WA: { lat: [45.5, 49.0], lon: [-124.9, -116.9] },
};

test("every configured county is a real Census county of its state", () => {
  for (const state of TRACKED_STATES) {
    const known = censusCounties.get(state.code)!;
    for (const region of state.regions) {
      for (const c of region.counties) {
        assert.ok(known.has(`${c} County`), `${state.code} ${region.label}: "${c}" is not a Census county name`);
      }
    }
  }
});

test("no county is in two regions, and keys are unique", () => {
  const keys = new Set<string>();
  for (const state of TRACKED_STATES) {
    const seen = new Map<string, string>();
    for (const region of state.regions) {
      assert.ok(!keys.has(region.key), `duplicate region key ${region.key}`);
      keys.add(region.key);
      for (const c of region.counties) {
        const k = countyKey(c);
        assert.ok(!seen.has(k), `${state.code}: ${c} is in both ${seen.get(k)} and ${region.label}`);
        seen.set(k, region.label);
      }
    }
  }
});

test("each marker falls inside its state", () => {
  for (const state of TRACKED_STATES) {
    const b = BOUNDS[state.code];
    for (const r of state.regions) {
      assert.ok(r.marker.lat >= b.lat[0] && r.marker.lat <= b.lat[1], `${r.key} latitude outside ${state.code}`);
      assert.ok(r.marker.lon >= b.lon[0] && r.marker.lon <= b.lon[1], `${r.key} longitude outside ${state.code}`);
    }
  }
});

test("the approved assignments", () => {
  assert.equal(regionFor("CA", "Ventura County")?.key, "southern_california", "Ventura stays in Southern California");
  assert.equal(regionFor("CA", "San Joaquin County")?.key, "delta");
  assert.equal(regionFor("CA", "Santa Cruz County")?.key, "central_coast");
  assert.equal(regionFor("CA", "Marin County")?.key, "sf_bay_area");
  assert.equal(regionFor("FL", "Monroe County")?.key, "florida_keys", "Keys kept separate");
  assert.equal(regionFor("FL", "Citrus County"), null, "Big Bend stays in other");
  assert.equal(regionFor("FL", "Orange County"), null, "Orlando lakes stay in other");
  assert.equal(regionFor("WA", "Thurston County")?.key, "central_puget_sound", "South Sound merged");
  assert.equal(regionFor("WA", "Mason County")?.key, "central_puget_sound");
});

test("lookups are forgiving of suffix and case; untracked or missing give null", () => {
  assert.equal(regionFor("ca", " marin county ")?.key, "sf_bay_area");
  assert.equal(regionFor("CA", "Marin")?.key, "sf_bay_area");
  assert.equal(regionFor("CA", "Orange County")?.key, "southern_california", "same county name, different state");
  assert.equal(regionFor("FL", "Orange County"), null);
  assert.equal(regionFor("CT", "Fairfield County"), null);
  assert.equal(regionFor("CA", null), null);
  assert.equal(trackedState("wa")?.label, "Washington");
  assert.equal(trackedState("OR"), null);
});
