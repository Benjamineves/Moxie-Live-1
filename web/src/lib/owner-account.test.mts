import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { displayNameFromEmail, ensureOwnerAccount, findOwnerAccount } from "./owner-account.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** Enough of the query builder for the two reads and the one insert. */
function fakeService(opts: {
  byEmail?: Result;
  byId?: Result;
  insert?: Result;
  /** A second read that happens after a failed insert (the race path). */
  byEmailAfterInsert?: Result;
}) {
  const calls: string[] = [];
  let inserted = false;
  const client = {
    from() {
      let filter = "";
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          filter = `${col}=${String(val)}`;
          return builder;
        },
        insert: (row: Record<string, unknown>) => {
          calls.push(`insert ${JSON.stringify(row)}`);
          inserted = true;
          return builder;
        },
        maybeSingle: async () => {
          calls.push(`read ${filter}`);
          if (filter.startsWith("email=")) {
            return (inserted ? opts.byEmailAfterInsert : undefined) ?? opts.byEmail ?? { data: null, error: null };
          }
          return opts.byId ?? { data: null, error: null };
        },
        single: async () => opts.insert ?? { data: null, error: null },
      };
      return builder;
    },
  } as never;
  return { client, calls };
}

const ROW = { id: "u-1", email: "owner@example.test", stripe_customer_id: null, subscription_status: null, stripe_subscription_id: null };

test("an existing row wins, is found by email first, and nothing is inserted", async () => {
  const { client, calls } = fakeService({ byEmail: { data: ROW, error: null } });
  assert.deepEqual(await ensureOwnerAccount(client, { id: "auth-9", email: " Owner@Example.test " }), ROW);
  assert.deepEqual(calls, ["read email=owner@example.test"]);
});

test("email first matters: a row whose id differs from the auth id is still theirs", async () => {
  // ben@moxieyachting.com's row id is a placeholder that differs from the
  // Auth id. Matching on id first would miss it and insert a duplicate
  // email, which the UNIQUE constraint would refuse.
  const placeholder = { ...ROW, id: "00000000-0000-0000-0000-000000000001" };
  const { client, calls } = fakeService({ byEmail: { data: placeholder, error: null } });
  const found = await ensureOwnerAccount(client, { id: "7f004b27", email: "owner@example.test" });
  assert.equal(found?.id, "00000000-0000-0000-0000-000000000001");
  assert.ok(!calls.some((c) => c.startsWith("insert")), "must not insert over an existing email");
});

test("a genuinely new email gets a row, keyed on the auth id", async () => {
  const created = { ...ROW, id: "auth-9", email: "new@example.test" };
  const { client, calls } = fakeService({ insert: { data: created, error: null } });
  assert.deepEqual(await ensureOwnerAccount(client, { id: "auth-9", email: "New@Example.test" }), created);
  const insert = calls.find((c) => c.startsWith("insert"));
  assert.ok(insert, "expected an insert");
  assert.match(insert!, /"id":"auth-9"/);
  assert.match(insert!, /"email":"new@example\.test"/);
  assert.match(insert!, /"role":"owner"/);
  assert.match(insert!, /"full_name":"New"/);
});

test("two tabs racing: a lost insert re-reads instead of reporting failure", async () => {
  const theirs = { ...ROW, id: "auth-other" };
  const { client } = fakeService({
    insert: { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint" } },
    byEmailAfterInsert: { data: theirs, error: null },
  });
  assert.deepEqual(await ensureOwnerAccount(client, { id: "auth-9", email: "new@example.test" }), theirs);
});

test("an insert that fails for a real reason throws", async () => {
  const { client } = fakeService({ insert: { data: null, error: { code: "42501", message: "permission denied" } } });
  await assert.rejects(ensureOwnerAccount(client, { id: "auth-9", email: "new@example.test" }), /permission denied/);
});

test("no email on the session: null, and no write", async () => {
  const { client, calls } = fakeService({});
  assert.equal(await ensureOwnerAccount(client, { id: "auth-9", email: null }), null);
  assert.ok(!calls.some((c) => c.startsWith("insert")));
  assert.equal(await findOwnerAccount(client, { id: "auth-9", email: null }), null);
});

test("display names come from the local part, with a fallback", () => {
  assert.equal(displayNameFromEmail("mary.anne-smith@example.test"), "Mary Anne Smith");
  assert.equal(displayNameFromEmail("polaris@example.test"), "Polaris");
  assert.equal(displayNameFromEmail("@example.test"), "Vessel Owner");
});

test("buying a plan creates the row; the Basic→Full upgrade still refuses without one", () => {
  const actions = readFileSync(`${SRC}app/dashboard/upgrade/actions.ts`, "utf8");
  const pay = actions.slice(0, actions.indexOf("export async function upgradeToFullAccess"));
  assert.match(pay, /ensureOwnerAccount\(service, user\)/, "the plan picker must create the row, not dead-end");
  assert.doesNotMatch(pay, /\.eq\("email", normalizedEmail\)/, "no second hand-rolled owner lookup");
  // upgradeToFullAccess needs an ACTIVE subscription, which an account
  // with no row cannot have — "not found" there is a true statement.
  const upgrade = actions.slice(actions.indexOf("export async function upgradeToFullAccess"));
  assert.match(upgrade, /Owner account not found\./);
});

test("notifyOwner throws when the in-app row cannot be written", () => {
  // The row IS the record. Logging the failure and returning {recorded:
  // true} reported a notification that does not exist.
  const notify = readFileSync(`${SRC}lib/notify.ts`, "utf8");
  const start = notify.indexOf('.from("owner_notifications")');
  const insertBlock = notify.slice(start, notify.indexOf("const recorded"));
  assert.match(insertBlock, /throw new Error\(`Failed to record \$\{type\} notification/);
  assert.doesNotMatch(insertBlock, /const recorded = !error/);
  // Email stays best-effort: it is an addition to the row, never a gate.
  assert.match(notify, /try \{[\s\S]{0,200}maybeSendNotificationEmail[\s\S]{0,400}\} catch/);
});
