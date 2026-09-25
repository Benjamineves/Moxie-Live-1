import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { isCountedVessel, rawLocation, summarizeGeography, topRegions, type GeoVessel } from "./geography.ts";
import { STATE_OUTLINES, projectToState } from "./geo/state-outlines.ts";
import { TRACKED_STATES } from "./region-config.ts";

const SRC = new URL("../", import.meta.url);
const v = (over: Partial<GeoVessel>): GeoVessel => ({
  mxe_id: "MXE-00000",
  vessel_name: "V",
  storage_state: null,
  storage_zip: null,
  storage_county: null,
  storage_city: null,
  storage_description: null,
  marina_name: null,
  marina_city: null,
  ...over,
});

test("counted = paid and not decommissioned; dormant still counts", () => {
  assert.equal(isCountedVessel({ qr_status: "active", lifecycle_status: "active" }), true);
  assert.equal(isCountedVessel({ qr_status: "active", lifecycle_status: "dormant" }), true);
  assert.equal(isCountedVessel({ qr_status: "active", lifecycle_status: "decommissioned" }), false);
  assert.equal(isCountedVessel({ qr_status: "pending_payment", lifecycle_status: "active" }), false);
});

test("every vessel lands in exactly one bucket", () => {
  const geo = summarizeGeography([
    v({ mxe_id: "A", storage_state: "CA", storage_zip: "94965", storage_county: "Marin County" }),
    v({ mxe_id: "B", storage_state: "CA", storage_zip: "95202", storage_county: "San Joaquin County" }),
    v({ mxe_id: "C", storage_state: "CA", storage_zip: "95501", storage_county: "Humboldt County" }),
    v({ mxe_id: "D", storage_state: "FL", storage_zip: "33477", storage_county: "Palm Beach County" }),
    v({ mxe_id: "E", storage_state: "CT", storage_zip: "06880", storage_county: "Fairfield County" }),
    v({ mxe_id: "F", storage_state: "CO", storage_zip: "80302", storage_county: "Boulder County" }),
    v({ mxe_id: "G", storage_state: "CT", storage_zip: "06830", storage_county: "Fairfield County" }),
    v({ mxe_id: "H", storage_state: "CA", storage_city: "Sausalito", marina_name: "Clipper" }),
  ]);
  const ca = geo.states.find((s) => s.code === "CA")!;
  assert.equal(ca.regions.find((r) => r.key === "sf_bay_area")!.count, 1);
  assert.equal(ca.regions.find((r) => r.key === "delta")!.count, 1);
  assert.equal(ca.otherRegions, 1, "Humboldt is 'California: other regions'");
  assert.equal(ca.total, 3);
  assert.equal(geo.states.find((s) => s.code === "FL")!.regions.find((r) => r.key === "southeast_florida")!.count, 1);
  assert.deepEqual(geo.outOfState, [
    { code: "CT", label: "Connecticut", count: 2 },
    { code: "CO", label: "Colorado", count: 1 },
  ]);
  assert.deepEqual(geo.missingZip, [{ mxe_id: "H", vessel_name: "V", storage_state: "CA", rawLocation: "Clipper · Sausalito · CA" }]);
  const placed = geo.states.reduce((n, s) => n + s.total, 0) + geo.outOfState.reduce((n, s) => n + s.count, 0) + geo.missingZip.length;
  assert.equal(placed, geo.counted, "no vessel dropped or double-counted");
  const top = topRegions(geo, 5);
  assert.deepEqual(top.map((r) => r.label).sort(), ["Delta", "SF Bay Area", "Southeast Florida"], "only regions with boats, across states");
  assert.equal(topRegions(geo, 2).length, 2, "limit honoured");
});

test("free text is never parsed: a Sausalito description without a ZIP is Missing ZIP, not SF Bay", () => {
  const geo = summarizeGeography([v({ storage_state: "CA", storage_description: "Sausalito, San Francisco Bay" })]);
  assert.equal(geo.missingZip.length, 1);
  assert.equal(geo.states.find((s) => s.code === "CA")!.total, 0);
  assert.equal(rawLocation(v({})), null);
});

test("the old combined 'Other (CA / out of state)' bucket and keyword classifier are gone", () => {
  assert.equal(existsSync(new URL("lib/vessel-geo.ts", SRC)), false);
  assert.equal(existsSync(new URL("components/AdminGeoMap.tsx", SRC)), false);
  for (const rel of ["app/admin/page.tsx", "app/admin/geography/page.tsx"]) {
    const src = readFileSync(new URL(rel, SRC), "utf8");
    assert.doesNotMatch(src, /CA \/ out of state|classifyRegion|vessel-geo/, rel);
  }
});

test("the overview and the geography page count with the same filter", () => {
  const overview = readFileSync(new URL("app/admin/page.tsx", SRC), "utf8");
  const geography = readFileSync(new URL("app/admin/geography/page.tsx", SRC), "utf8");
  assert.ok((overview.match(/countedVesselsFilter\(/g) ?? []).length >= 5, "all overview vessel counts use the shared filter");
  assert.match(geography, /countedVesselsFilter\(/);
  assert.doesNotMatch(overview, /service\.from\("vessels"\)\.select\("id", \{ count: "exact", head: true \}\)\s*,/, "an unfiltered vessel count");
});

test("every region marker projects inside its state's drawing", () => {
  for (const s of TRACKED_STATES) {
    const o = STATE_OUTLINES[s.code];
    for (const r of s.regions) {
      const { x, y } = projectToState(o, r.marker.lat, r.marker.lon);
      assert.ok(x >= 0 && x <= o.width && y >= 0 && y <= o.height, `${s.code} ${r.key} at ${x.toFixed(1)},${y.toFixed(1)}`);
    }
  }
});
