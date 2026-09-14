import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { checkStripeForPayments, judgePaymentIntents } from "./unpaid-vessel-delete.ts";

const SRC = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.m?ts$/.test(name) ? [path] : [];
  });
}

test("only the shared helper calls delete_unactivated_vessel", () => {
  // The Stripe check lives in the helper, not the function, so any other
  // caller of the function would be a delete that skips it. That is how the
  // owner's delete button came to have no Stripe check at all.
  const callers = sourceFiles(SRC)
    .filter((file) => /rpc\(\s*["']delete_unactivated_vessel["']/.test(readFileSync(file, "utf8")))
    .map((file) => relative(SRC, file));
  assert.deepEqual(callers, ["lib/unpaid-vessel-delete.ts"]);
});

test("a payment intent in any live state blocks the delete", () => {
  for (const status of ["succeeded", "processing", "requires_capture", "requires_action", "requires_confirmation"]) {
    const d = judgePaymentIntents([{ id: "pi_1", status }]);
    assert.equal(d.safe, false, status);
    if (!d.safe) assert.equal(d.reason, "payment_found");
  }
});

test("only dead intents are safe", () => {
  assert.equal(judgePaymentIntents([]).safe, true);
  assert.equal(
    judgePaymentIntents([
      { id: "pi_1", status: "canceled" },
      { id: "pi_2", status: "requires_payment_method" },
    ]).safe,
    true,
  );
  // One live intent among dead ones still blocks.
  assert.equal(
    judgePaymentIntents([
      { id: "pi_1", status: "canceled" },
      { id: "pi_2", status: "succeeded" },
    ]).safe,
    false,
  );
});

/** A fake Stripe with just the two calls the check makes. */
function fakeStripe(opts: {
  search?: { id: string; status: string; metadata?: Record<string, string> }[];
  searchHasMore?: boolean;
  customer?: { id: string; status: string; metadata?: Record<string, string> }[];
  searchThrows?: boolean;
}) {
  return {
    paymentIntents: {
      search: async () => {
        if (opts.searchThrows) throw new Error("Stripe is down");
        return { data: opts.search ?? [], has_more: !!opts.searchHasMore };
      },
      list: () =>
        (async function* () {
          for (const i of opts.customer ?? []) yield i;
        })(),
    },
  } as never;
}

test("an unreachable Stripe refuses rather than allowing", async () => {
  const d = await checkStripeForPayments("MXE-01024", "cus_1", fakeStripe({ searchThrows: true }));
  assert.equal(d.safe, false);
  if (!d.safe) assert.equal(d.reason, "unverifiable");
});

test("a payment the search index has not caught up with is found by the customer listing", async () => {
  // The search lags about a minute; the customer list does not.
  const d = await checkStripeForPayments(
    "MXE-01024",
    "cus_1",
    fakeStripe({ search: [], customer: [{ id: "pi_new", status: "succeeded", metadata: { mxe_id: "MXE-01024" } }] }),
  );
  assert.equal(d.safe, false);
});

test("the customer's payments for OTHER vessels do not block this one", async () => {
  const d = await checkStripeForPayments(
    "MXE-01024",
    "cus_1",
    fakeStripe({ customer: [{ id: "pi_other", status: "succeeded", metadata: { mxe_id: "MXE-01006" } }] }),
  );
  assert.equal(d.safe, true);
});

test("too many matches to read completely refuses", async () => {
  const d = await checkStripeForPayments("MXE-01024", null, fakeStripe({ searchHasMore: true }));
  assert.equal(d.safe, false);
});

test("a malformed MXE ID refuses before any query is built from it", async () => {
  const d = await checkStripeForPayments("MXE-01024' OR status:'succeeded", null, fakeStripe({}));
  assert.equal(d.safe, false);
});
