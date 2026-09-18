import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildMarinaDormantView,
  buildMarinaView,
  buildRosterRow,
  matchesRosterQuery,
  rankRoster,
  type MarinaViewSource,
  type RosterRow,
} from "./marina-view.ts";
import { marinaNameChanged, marinaSharingSummary } from "./marina-copy.ts";
import {
  JOIN_CODE_ALPHABET,
  decideMarinaDocument,
  decideMarinaViewer,
  formatJoinCode,
  grantMarinaAccess,
  loadActiveAccess,
  loadMarinaByJoinCode,
  loadMarinaRoster,
  loadVesselMarinaAccess,
  normalizeJoinCode,
  updateMarinaAccessDocuments,
  resolveMarinaViewer,
  revokeMarinaAccess,
  type ActiveAccess,
  type MarinaMembership,
  type VesselGate,
} from "./marina-access.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));
const MIGRATION = fileURLToPath(new URL("../../../supabase/migrations/20261007_marina_access.sql", import.meta.url));
const GENERATOR = fileURLToPath(new URL("../../../supabase/migrations/20261008_marina_join_code_generator.sql", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.m?ts$/.test(name) ? [path] : [];
  });
}

// ─── Fixtures ─────────────────────────────────────────────────────────────

/**
 * A whole vessel row's worth of private data, so the projection has every
 * chance to leak something it shouldn't.
 */
const VESSEL = {
  mxe_id: "MXE-09001",
  vessel_name: "Fixture",
  make: "Catalina",
  model: "22",
  year: 1998,
  vessel_type: "Sailboat",
  photo_url: null,
  slip_number: "B12",
  owner_name: "Owner Fixture",
  owner_phone: "555-0100",
  owner_email: "owner@example.test",
  emg_name: "Emergency Fixture",
  emg_phone: "555-0199",
  emg_relationship: "Sibling",
  doc_registration_url: "owner-uuid/MXE-09001/registration",
  doc_insurance_url: "owner-uuid/MXE-09001/insurance",
  reg_expiry: "2027-03-15",
  ins_expiry: "2026-01-01",
  // Everything below must never reach a marina.
  slip_notes: "Spare key under the cushion",
  is_liveaboard: true,
  access_note: "Gate 4471",
  hin: "ABC12345D898",
  uscg_doc_number: "1234567",
  official_number: "OFF-1",
  ins_carrier: "Carrier Co",
  ins_policy: "POL-1",
  doc_boater_card_url: "owner-uuid/MXE-09001/boater_card",
  doc_fishing_license_url: "owner-uuid/MXE-09001/fishing_license",
} as MarinaViewSource & Record<string, unknown>;

const BOTH = { share_registration: true, share_insurance: true };
const NEITHER = { share_registration: false, share_insurance: false };

const MARINA: MarinaMembership = { marinaId: "m-1", name: "Emery Cove Marina", city: "Emeryville" };
const GATE: VesselGate = { id: "v-1", qr_status: "active", lifecycle_status: "active", dormant_cause: null };
const ACCESS: ActiveAccess = {
  id: "a-1",
  marina_id: "m-1",
  vessel_id: "v-1",
  share_registration: true,
  share_insurance: false,
  granted_at: "2026-09-18T00:00:00Z",
};

// ─── The projection ───────────────────────────────────────────────────────

test("the marina view is exactly the spec's field set", () => {
  const view = buildMarinaView(VESSEL, BOTH);
  assert.deepEqual(Object.keys(view).sort(), [
    "emergency",
    "insurance",
    "make",
    "model",
    "mxe_id",
    "owner",
    "photo_url",
    "registration",
    "slip",
    "vessel_name",
    "vessel_type",
    "year",
  ]);
  assert.deepEqual(view.owner, { name: "Owner Fixture", phone: "555-0100", email: "owner@example.test" });
  assert.deepEqual(view.emergency, { name: "Emergency Fixture", phone: "555-0199", relationship: "Sibling" });
});

test("nothing private, and no storage path, leaves the projection", () => {
  const serialized = JSON.stringify(buildMarinaView(VESSEL, BOTH));
  for (const secret of [
    "Spare key",
    "Gate 4471",
    "ABC12345D898",
    "1234567",
    "OFF-1",
    "Carrier Co",
    "POL-1",
    "owner-uuid/",
    "liveaboard",
  ]) {
    assert.ok(!serialized.includes(secret), `leaked ${secret}`);
  }
});

test("an empty emergency contact is null — the row says so, it isn't dropped", () => {
  const view = buildMarinaView({ ...VESSEL, emg_name: "  ", emg_phone: null, emg_relationship: "" }, BOTH);
  assert.ok("emergency" in view);
  assert.equal(view.emergency, null);

  const partial = buildMarinaView({ ...VESSEL, emg_name: null, emg_relationship: null }, BOTH);
  assert.deepEqual(partial.emergency, { name: null, phone: "555-0199", relationship: null });
});

test("each document is one of three stated states", () => {
  assert.deepEqual(buildMarinaView(VESSEL, BOTH).registration, { state: "on_file", format: "image", ownerEnteredExpiry: "2027-03-15" });
  assert.deepEqual(buildMarinaView({ ...VESSEL, doc_insurance_url: "o/MXE-09001/insurance.PDF" }, BOTH).insurance, {
    state: "on_file",
    format: "pdf",
    ownerEnteredExpiry: "2026-01-01",
  });
  assert.deepEqual(buildMarinaView({ ...VESSEL, doc_insurance_url: null }, BOTH).insurance, { state: "missing" });
  // Not shared wins over on file: the owner's choice, not what exists.
  assert.deepEqual(buildMarinaView(VESSEL, NEITHER).registration, { state: "not_shared" });
  assert.deepEqual(buildMarinaView(VESSEL, NEITHER).insurance, { state: "not_shared" });
  // An expiry with no document is not shown as though it described one.
  assert.deepEqual(buildMarinaView({ ...VESSEL, doc_registration_url: null }, BOTH).registration, { state: "missing" });
});

test("a dormant vessel shows emergency contact and nothing else", () => {
  const dormant = buildMarinaDormantView(VESSEL);
  assert.deepEqual(Object.keys(dormant), ["emergency"]);
  assert.equal(buildMarinaDormantView({ emg_name: null, emg_phone: null, emg_relationship: null }).emergency, null);
});

// ─── Join code ────────────────────────────────────────────────────────────

test("join codes forgive case, spaces and the hyphen, and nothing else", () => {
  assert.equal(normalizeJoinCode("emry-7k4q"), "EMRY7K4Q");
  assert.equal(normalizeJoinCode(" EMRY 7K4Q "), "EMRY7K4Q");
  assert.equal(normalizeJoinCode("EMRY7K4"), null, "too short");
  assert.equal(normalizeJoinCode("EMRY7K4QQ"), null, "too long");
  // Look-alikes are refused, not guessed: a wrong guess is another marina.
  for (const bad of ["EMRY-7K40", "EMRY-7K4O", "EMRY-7K41", "EMRY-7K4I", "EMRY-7K4L"]) {
    assert.equal(normalizeJoinCode(bad), null, bad);
  }
  assert.equal(normalizeJoinCode(null), null);
  assert.equal(formatJoinCode("EMRY7K4Q"), "EMRY-7K4Q");
});

test("the app's alphabet is exactly what the CHECK accepts and the SQL generator draws from", () => {
  const generator = readFileSync(GENERATOR, "utf8");
  assert.match(generator, new RegExp(`alphabet CONSTANT TEXT := '${JOIN_CODE_ALPHABET}'`));
  const sql = readFileSync(MIGRATION, "utf8");
  const match = /join_code ~ '\^\[([^\]]+)\]\{8\}\$'/.exec(sql);
  assert.ok(match, "CHECK constraint not found in 20261007");
  const re = new RegExp(`^[${match[1]}]$`);
  const accepted = [..."0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"].filter((c) => re.test(c)).join("");
  assert.equal(accepted, JOIN_CODE_ALPHABET);
});

// ─── The decision ─────────────────────────────────────────────────────────

test("not a marina user: nothing changes", () => {
  assert.deepEqual(decideMarinaViewer(null, ACCESS, GATE), { kind: "none" });
});

test("a marina user without a grant gets the banner, not the view", () => {
  assert.equal(decideMarinaViewer(MARINA, null, GATE).kind, "no_access");
});

test("a grant for another marina or another vessel is not this one's", () => {
  assert.equal(decideMarinaViewer(MARINA, { ...ACCESS, marina_id: "m-2" }, GATE).kind, "no_access");
  assert.equal(decideMarinaViewer(MARINA, { ...ACCESS, vessel_id: "v-2" }, GATE).kind, "no_access");
});

test("pending and decommissioned vessels never show the marina view", () => {
  assert.equal(decideMarinaViewer(MARINA, ACCESS, { ...GATE, qr_status: "pending_payment" }).kind, "no_access");
  assert.equal(decideMarinaViewer(MARINA, ACCESS, { ...GATE, lifecycle_status: "decommissioned" }).kind, "no_access");
});

test("a dormant vessel keeps its grant, marked dormant", () => {
  const viewer = decideMarinaViewer(MARINA, ACCESS, { ...GATE, lifecycle_status: "dormant", dormant_cause: "lapsed" });
  assert.equal(viewer.kind, "access");
  assert.equal(viewer.kind === "access" && viewer.dormant, true);
});

test("documents: only what the owner included, only registration and insurance, never while dormant", () => {
  const viewer = decideMarinaViewer(MARINA, ACCESS, GATE);
  assert.equal(decideMarinaDocument(viewer, "registration"), true);
  assert.equal(decideMarinaDocument(viewer, "insurance"), false, "not included");
  assert.equal(decideMarinaDocument(viewer, "boater_card"), false);
  assert.equal(decideMarinaDocument(viewer, "fishing_license"), false);

  const everything = decideMarinaViewer(MARINA, { ...ACCESS, share_insurance: true }, GATE);
  assert.equal(decideMarinaDocument(everything, "boater_card"), false, "even with both included");

  const dormant = decideMarinaViewer(MARINA, ACCESS, { ...GATE, lifecycle_status: "dormant", dormant_cause: "locked" });
  assert.equal(decideMarinaDocument(dormant, "registration"), false);

  assert.equal(decideMarinaDocument(decideMarinaViewer(MARINA, null, GATE), "registration"), false);
  assert.equal(decideMarinaDocument({ kind: "none" }, "registration"), false);
});

// ─── Loaders, against a fake client ───────────────────────────────────────

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** Just enough of the query builder: every filter is chainable, maybeSingle resolves. */
function fakeService(tables: Record<string, Result>, rpc: Record<string, Result> = {}) {
  const seen: { table: string; filters: [string, string, unknown][] }[] = [];
  return {
    seen,
    client: {
      from(table: string) {
        const entry = { table, filters: [] as [string, string, unknown][] };
        seen.push(entry);
        const builder = {
          select: () => builder,
          eq: (col: string, val: unknown) => (entry.filters.push(["eq", col, val]), builder),
          is: (col: string, val: unknown) => (entry.filters.push(["is", col, val]), builder),
          in: (col: string, val: unknown) => (entry.filters.push(["in", col, val]), builder),
          order: () => builder,
          maybeSingle: async () => tables[table] ?? { data: null, error: null },
          then: (resolve: (r: Result) => unknown) => resolve(tables[table] ?? { data: [], error: null }),
        };
        return builder;
      },
      rpc: async (name: string) => rpc[name] ?? { data: null, error: { message: `no fake for ${name}` } },
    } as never,
  };
}

test("before the migration runs, a missing table means no access — not a 500", async () => {
  for (const code of ["PGRST205", "42P01"]) {
    const { client } = fakeService({ marina_vessel_access: { data: null, error: { code, message: "missing" } } });
    assert.equal(await loadActiveAccess(client, "m-1", "v-1"), null);
  }
  const { client } = fakeService({ marina_vessel_access: { data: null, error: { code: "57014", message: "timeout" } } });
  await assert.rejects(loadActiveAccess(client, "m-1", "v-1"), /timeout/);
});

test("active access is only ever an unrevoked row", async () => {
  const { client, seen } = fakeService({ marina_vessel_access: { data: ACCESS, error: null } });
  await loadActiveAccess(client, "m-1", "v-1");
  assert.deepEqual(seen[0].filters, [
    ["eq", "marina_id", "m-1"],
    ["eq", "vessel_id", "v-1"],
    ["is", "revoked_at", null],
  ]);
});

test("membership is by users.marina_id, looked up by email", async () => {
  const { client, seen } = fakeService({
    users: { data: { marina_id: "m-1" }, error: null },
    marinas: { data: { id: "m-1", name: "Emery Cove Marina", city: "Emeryville" }, error: null },
    marina_vessel_access: { data: ACCESS, error: null },
  });
  const viewer = await resolveMarinaViewer(client, "  Staff@Example.test ", GATE);
  assert.equal(viewer.kind, "access");
  assert.deepEqual(seen[0].filters, [["eq", "email", "staff@example.test"]]);

  const signedOut = fakeService({});
  assert.deepEqual(await resolveMarinaViewer(signedOut.client, null, GATE), { kind: "none" });
  assert.equal(signedOut.seen.length, 0, "no query for a signed-out visitor");

  const owner = fakeService({ users: { data: { marina_id: null }, error: null } });
  assert.deepEqual(await resolveMarinaViewer(owner.client, "owner@example.test", GATE), { kind: "none" });
});

test("RPC refusals map to typed results; anything else throws", async () => {
  const refusals: [string, string][] = [
    ["MX030", "unknown_code"],
    ["MX031", "not_owner"],
    ["MX032", "vessel_not_eligible"],
  ];
  for (const [code, refusal] of refusals) {
    const { client } = fakeService({}, { grant_marina_access: { data: null, error: { code, message: code } } });
    assert.deepEqual(
      await grantMarinaAccess(client, { ownerId: "o", vesselId: "v", joinCode: "EMRY-7K4Q", ...BOTH }),
      { ok: false, refusal },
    );
  }
  // A malformed code never reaches the database.
  const untouched = fakeService({}, {});
  assert.deepEqual(
    await grantMarinaAccess(untouched.client, { ownerId: "o", vesselId: "v", joinCode: "nope", ...BOTH }),
    { ok: false, refusal: "unknown_code" },
  );

  const broken = fakeService({}, { grant_marina_access: { data: null, error: { code: "XX000", message: "boom" } } });
  await assert.rejects(
    grantMarinaAccess(broken.client, { ownerId: "o", vesselId: "v", joinCode: "EMRY-7K4Q", ...BOTH }),
    /boom/,
  );

  const revoked = fakeService({}, { revoke_marina_access: { data: true, error: null } });
  assert.deepEqual(await revokeMarinaAccess(revoked.client, { ownerId: "o", accessId: "a" }), { ok: true, changed: true });
  const notFound = fakeService({}, { revoke_marina_access: { data: null, error: { code: "MX033", message: "x" } } });
  assert.deepEqual(await revokeMarinaAccess(notFound.client, { ownerId: "o", accessId: "a" }), {
    ok: false,
    refusal: "not_found",
  });
});

// ─── One path ─────────────────────────────────────────────────────────────

test("only lib/marina-access.ts touches marina_vessel_access or its RPCs", () => {
  const pattern = /from\(\s*["']marina_vessel_access["']|rpc\(\s*["']((grant|revoke)_marina_access|generate_marina_join_code)["']/;
  const callers = sourceFiles(SRC)
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file));
  assert.deepEqual(callers, ["lib/marina-access.ts"]);
});

test("nothing builds a marina view except buildMarinaView", () => {
  // filterVesselForRole's old marina branch leaked slip_notes and
  // is_liveaboard and had no emergency contact. It now refuses.
  const source = readFileSync(join(SRC, "lib/vessel-service.ts"), "utf8");
  assert.match(source, /role: Exclude<ProfileRole, "marina">/);
  assert.match(source, /throw new Error\("filterVesselForRole does not build the marina view/);
});

test("the URL never authorizes the marina view; the documents route asks the helper", () => {
  // ?role=marina is where a scan lands. If the page ever branched on it,
  // anyone could append it to a URL. Access is re-derived from the session.
  const page = readFileSync(join(SRC, "app/[mxeId]/page.tsx"), "utf8");
  assert.doesNotMatch(page, /roleParam\s*===\s*["']marina["']|sp\.role[^;\n]*marina/);
  assert.match(page, /resolveMarinaViewer\(/);

  const route = readFileSync(join(SRC, "app/api/vessels/[mxeId]/documents/[docType]/route.ts"), "utf8");
  assert.match(route, /decideMarinaDocument\(/);
});

// ─── Stage 4: the join page and the owner's controls ─────────────────────

test("a join code resolves to one marina; a malformed one never queries; a missing column is 'no marina'", async () => {
  const found = fakeService({ marinas: { data: { id: "m-1", name: "Emery Cove Marina", city: "Emeryville" }, error: null } });
  assert.deepEqual(await loadMarinaByJoinCode(found.client, "7tjy-kftk"), { id: "m-1", name: "Emery Cove Marina", city: "Emeryville" });
  assert.deepEqual(found.seen[0].filters, [["eq", "join_code", "7TJYKFTK"]]);

  const malformed = fakeService({});
  assert.equal(await loadMarinaByJoinCode(malformed.client, "7TJY-KFT0"), null);
  assert.equal(malformed.seen.length, 0);

  const beforeMigration = fakeService({ marinas: { data: null, error: { code: "42703", message: "no column" } } });
  assert.equal(await loadMarinaByJoinCode(beforeMigration.client, "7TJY-KFTK"), null);
});

test("the owner's list carries each grant's marina and tolerates the table not existing", async () => {
  const listed = fakeService({
    marina_vessel_access: { data: [{ ...ACCESS, marinas: { id: "m-1", name: "Emery Cove Marina", city: null } }], error: null },
  });
  const grants = await loadVesselMarinaAccess(listed.client, ["v-1"]);
  assert.equal(grants[0].marina.name, "Emery Cove Marina");
  assert.ok(!("marinas" in grants[0]));
  assert.deepEqual(listed.seen[0].filters, [
    ["in", "vessel_id", ["v-1"]],
    ["is", "revoked_at", null],
  ]);

  const missing = fakeService({ marina_vessel_access: { data: null, error: { code: "PGRST205", message: "missing" } } });
  assert.deepEqual(await loadVesselMarinaAccess(missing.client, ["v-1"]), []);
  const none = fakeService({});
  assert.deepEqual(await loadVesselMarinaAccess(none.client, []), []);
  assert.equal(none.seen.length, 0);
});

test("changing documents re-grants through the marina's current code, and refuses if it has none", async () => {
  const withCode = fakeService(
    { marinas: { data: { join_code: "7TJYKFTK" }, error: null } },
    { grant_marina_access: { data: [{ access_id: "a-1", marina_id: "m-1", created: false }], error: null } },
  );
  assert.deepEqual(
    await updateMarinaAccessDocuments(withCode.client, { ownerId: "o", vesselId: "v-1", marinaId: "m-1", ...NEITHER }),
    { ok: true, accessId: "a-1", marinaId: "m-1", created: false },
  );
  const noCode = fakeService({ marinas: { data: { join_code: null }, error: null } });
  assert.deepEqual(
    await updateMarinaAccessDocuments(noCode.client, { ownerId: "o", vesselId: "v-1", marinaId: "m-1", ...BOTH }),
    { ok: false, refusal: "unknown_code" },
  );
});

test("the confirm sentence promises exactly the marina view: contact always, documents only as chosen", () => {
  const both = marinaSharingSummary("Emery Cove Marina", "Polaris", true, true);
  assert.match(both, /contact details, emergency contact and slip number, plus your registration and insurance documents/);
  const none = marinaSharingSummary("Emery Cove Marina", "Polaris", false, false);
  assert.doesNotMatch(none, /registration|insurance/);
  assert.match(marinaSharingSummary("M", "V", false, true), /plus your insurance document /);
  // Nothing the view doesn't show.
  for (const s of [both, none]) assert.doesNotMatch(s, /slip notes|lockbox|gate|HIN|address/i);
});

test("the confirm step says it doesn't expire, can be removed any time, and isn't notified", () => {
  const form = readFileSync(join(SRC, "app/marina/join/ShareWithMarinaForm.tsx"), "utf8");
  assert.match(form, /doesn&apos;t expire/);
  assert.match(form, /remove it at any time/);
  assert.match(form, /isn&apos;t notified/);
  // And a grant is only ever sent from the confirm step.
  assert.equal(form.match(/shareVesselWithMarina\(/g)?.length, 1);
  assert.match(form, /confirming \?[\s\S]*shareVesselWithMarina\(/);
});

test("the join page names the marina before anything can be granted", () => {
  const page = readFileSync(join(SRC, "app/marina/join/page.tsx"), "utf8");
  const nameAt = page.indexOf("{marina.name}</h1>");
  const formAt = page.indexOf("<ShareWithMarinaForm");
  assert.ok(nameAt > 0 && formAt > nameAt, "the marina's name must render above the form");
  assert.match(page, /marinaName=\{marina\.name\}/);
});

test("a marina move is a change of name, not of case or spacing; leaving a marina counts", () => {
  assert.equal(marinaNameChanged("Emery Cove Marina", "emery  cove marina "), false);
  assert.equal(marinaNameChanged("Emery Cove Marina", "Marina Plaza Harbor"), true);
  assert.equal(marinaNameChanged("Emery Cove Marina", null), true);
  assert.equal(marinaNameChanged(null, ""), false);
});

// ─── Stage 5: the roster ──────────────────────────────────────────────────

test("a roster row marks a missing emergency contact and no viewable documents", () => {
  const full = buildRosterRow(VESSEL, BOTH, false);
  assert.deepEqual(full, {
    mxe_id: "MXE-09001",
    vessel_name: "Fixture",
    slip: "B12",
    owner_name: "Owner Fixture",
    paused: false,
    hasEmergencyContact: true,
    noDocuments: false,
  });
  // A name with no phone can't be called: still flagged.
  assert.equal(buildRosterRow({ ...VESSEL, emg_phone: null }, BOTH, false).hasEmergencyContact, false);
  // None included, or included but none uploaded: both are "no documents".
  assert.equal(buildRosterRow(VESSEL, NEITHER, false).noDocuments, true);
  assert.equal(buildRosterRow({ ...VESSEL, doc_registration_url: null, doc_insurance_url: null }, BOTH, false).noDocuments, true);
  assert.equal(buildRosterRow({ ...VESSEL, doc_insurance_url: null }, BOTH, false).noDocuments, false);
});

test("a paused row keeps what finds the boat and the emergency marker, nothing else", () => {
  const paused = buildRosterRow(VESSEL, BOTH, true);
  assert.equal(paused.paused, true);
  assert.equal(paused.owner_name, null);
  assert.equal(paused.noDocuments, null);
  assert.equal(paused.slip, "B12");
  assert.equal(paused.hasEmergencyContact, true);
});

test("search finds a boat the way it's typed at the dock", () => {
  const rows: RosterRow[] = [
    { ...buildRosterRow(VESSEL, BOTH, false), vessel_name: "Polaris", slip: "B12", mxe_id: "MXE-01016" },
    { ...buildRosterRow(VESSEL, BOTH, false), vessel_name: "Blue Moon", slip: "A3", mxe_id: "MXE-01020" },
    { ...buildRosterRow(VESSEL, BOTH, false), vessel_name: "Bravo", slip: "B120", mxe_id: "MXE-01021" },
  ];
  for (const q of ["b12", "B-12", "b 12"]) assert.ok(matchesRosterQuery(rows[0], q), q);
  assert.ok(matchesRosterQuery(rows[0], "pola"));
  assert.ok(matchesRosterQuery(rows[0], "01016"));
  assert.equal(matchesRosterQuery(rows[1], "b12"), false);
  // "B12" puts slip B12 above B120, and the empty query lists everyone alphabetically.
  assert.deepEqual(rankRoster(rows, "b12").map((r) => r.slip), ["B12", "B120"]);
  assert.deepEqual(rankRoster(rows, "").map((r) => r.vessel_name), ["Blue Moon", "Bravo", "Polaris"]);
  const numbered = ["Tern 10", "Tern 2", "tern 1"].map((vessel_name) => ({ ...rows[0], vessel_name }));
  assert.deepEqual(rankRoster(numbered, "").map((r) => r.vessel_name), ["tern 1", "Tern 2", "Tern 10"]);
});

test("the roster lists only what a scan would show this marina", async () => {
  const vessel = (overrides: Record<string, unknown>) => ({
    ...VESSEL,
    id: "v-1",
    qr_status: "active",
    lifecycle_status: "active",
    dormant_cause: null,
    ...overrides,
  });
  const { client, seen } = fakeService({
    marina_vessel_access: {
      data: [
        { ...ACCESS, id: "a-1", vessel_id: "v-1", vessels: vessel({ id: "v-1", vessel_name: "Zed" }) },
        { ...ACCESS, id: "a-2", vessel_id: "v-2", vessels: vessel({ id: "v-2", vessel_name: "Gone", lifecycle_status: "decommissioned" }) },
        { ...ACCESS, id: "a-3", vessel_id: "v-3", vessels: vessel({ id: "v-3", vessel_name: "Asleep", lifecycle_status: "dormant", dormant_cause: "lapsed" }) },
        { ...ACCESS, id: "a-4", vessel_id: "v-4", marina_id: "m-2", vessels: vessel({ id: "v-4", vessel_name: "Other marina" }) },
      ],
      error: null,
    },
  });
  const roster = await loadMarinaRoster(client, MARINA);
  assert.deepEqual(roster.map((r) => [r.vessel_name, r.paused]), [["Asleep", true], ["Zed", false]]);
  assert.deepEqual(seen[0].filters, [["eq", "marina_id", "m-1"], ["is", "revoked_at", null]]);

  const missing = fakeService({ marina_vessel_access: { data: null, error: { code: "PGRST205", message: "missing" } } });
  assert.deepEqual(await loadMarinaRoster(missing.client, MARINA), []);
});
