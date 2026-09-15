import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type Stripe from "stripe";
import {
  QUOTE_MAX_AGE_SECONDS,
  checkProrationDate,
  decideTierUpgradeCompletion,
  upgradeProrationCents,
} from "./tier-upgrade.ts";

const BASIC = "price_1UBJBvF2ijdqsFlLI53vIrU5";
const FULL = "price_1U8lmnF2ijdqsFlLiI4xOCjq";
process.env.STRIPE_PRICE_ID_BASIC_SUBSCRIPTION = BASIC;
process.env.STRIPE_PRICE_ID_FULL = FULL;

const app = (path: string) => readFileSync(fileURLToPath(new URL(`../../app/${path}`, import.meta.url)), "utf8");

/** The body of one exported/async function in a source file. */
function fnBody(source: string, name: string): string {
  const start = source.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} not found`);
  const next = source.slice(start + 1).search(/\n(export )?(async )?function |\ntype |\n\/\*\*/);
  return next < 0 ? source.slice(start) : source.slice(start, start + 1 + next);
}

test("the proration date is bounded: not future, not stale, inside the period", () => {
  const now = 1_789_442_118;
  const period = { periodStart: now - 86_400, periodEnd: now + 86_400 * 300 };
  assert.equal(checkProrationDate({ prorationDate: now, now, ...period }), null);
  assert.equal(checkProrationDate({ prorationDate: now - QUOTE_MAX_AGE_SECONDS, now, ...period }), null);
  assert.equal(checkProrationDate({ prorationDate: now - QUOTE_MAX_AGE_SECONDS - 1, now, ...period }), "stale");
  // A later date would charge less.
  assert.equal(checkProrationDate({ prorationDate: now + 1, now, ...period }), "future");
  assert.equal(checkProrationDate({ prorationDate: now - 10, now, periodStart: now - 5, periodEnd: now + 5 }), "outside_period");
  assert.equal(checkProrationDate({ prorationDate: "1789442118", now, ...period }), "invalid");
  assert.equal(checkProrationDate({ prorationDate: now + 0.5, now, ...period }), "invalid");
});

function line(amount: number, price: string, opts: { item?: string; proration?: boolean; start: number }): Stripe.InvoiceLineItem {
  return {
    amount,
    period: { start: opts.start, end: 1_819_912_613 },
    pricing: { type: "price_details", price_details: { price } },
    parent: {
      type: "subscription_item_details",
      subscription_item_details: { proration: opts.proration ?? true, subscription_item: opts.item ?? "si_VBh28lBOQfvWEG" },
      invoice_item_details: null,
    },
  } as unknown as Stripe.InvoiceLineItem;
}

test("the charge is this upgrade's proration only, not pending items the preview sweeps in", () => {
  // Shape read from invoices.createPreview on sub_1UBJeT… (2026-09-15): the
  // new proration lines start at the proration_date; its two uninvoiced
  // 2 Sept items start at 1788381812 and ride along.
  const prorationDate = 1_789_442_118;
  const lines = [
    line(-5701, BASIC, { start: prorationDate }), // unused Basic
    line(14397, FULL, { start: prorationDate }), // remaining Full
    line(-5899, BASIC, { start: 1_788_381_812 }), // pending from 2 Sept
    line(14898, FULL, { start: 1_788_381_812 }), // pending from 2 Sept
    line(14900, FULL, { start: 1_819_912_613, proration: false }), // next period, if previewed
    line(999, FULL, { start: prorationDate, item: "si_other" }), // another item
  ];
  assert.equal(upgradeProrationCents(lines, "si_VBh28lBOQfvWEG", prorationDate), 14397 - 5701);
});

test("the webhook applies a paid upgrade only to a live subscription on the quoted Basic item", () => {
  assert.deepEqual(decideTierUpgradeCompletion({ subscriptionStatus: "active", itemPriceId: BASIC, toPriceId: FULL }), { kind: "swap" });
  assert.deepEqual(decideTierUpgradeCompletion({ subscriptionStatus: "past_due", itemPriceId: BASIC, toPriceId: FULL }), { kind: "swap" });
  // Redelivery after the swap.
  assert.deepEqual(decideTierUpgradeCompletion({ subscriptionStatus: "active", itemPriceId: FULL, toPriceId: FULL }), { kind: "already_swapped" });
  for (const status of ["canceled", "unpaid", "incomplete_expired"]) {
    assert.deepEqual(decideTierUpgradeCompletion({ subscriptionStatus: status, itemPriceId: BASIC, toPriceId: FULL }), { kind: "not_live" });
  }
  assert.equal(decideTierUpgradeCompletion({ subscriptionStatus: "active", itemPriceId: null, toPriceId: FULL }).kind, "mismatch");
  assert.equal(decideTierUpgradeCompletion({ subscriptionStatus: "active", itemPriceId: BASIC, toPriceId: BASIC }).kind, "mismatch");
  assert.equal(decideTierUpgradeCompletion({ subscriptionStatus: "active", itemPriceId: "price_other", toPriceId: FULL }).kind, "mismatch");
});

test("the upgrade checkout never changes the subscription, and charges only a re-quoted, matching amount", () => {
  const action = fnBody(app("dashboard/upgrade/actions.ts"), "upgradeToFullAccess");
  // The defect: the item swap ran before any payment.
  assert.doesNotMatch(action, /subscriptions\.update\(/, "the checkout must not swap the subscription — the webhook does, after payment");
  assert.doesNotMatch(action, /customerSessions\.create\(/, "no Stripe objects beyond the invoice");
  const requote = action.indexOf("quoteTierUpgrade(");
  const compare = action.indexOf("quote.amountCents !== expectedAmountCents");
  const create = action.indexOf("stripe.invoices.create(");
  assert.ok(requote >= 0 && compare > requote && create > compare, "re-quote, compare with what was shown, then create the invoice");
  const invoiceParams = action.slice(create, action.indexOf("});", create));
  assert.match(invoiceParams, /auto_advance:\s*false/);
  assert.match(invoiceParams, /pending_invoice_items_behavior:\s*"exclude"/);
  assert.doesNotMatch(invoiceParams, /subscription:/, "standalone: a subscription invoice's intent carries setup_future_usage off_session");
});

test("the webhook records a paid upgrade before swapping, and swaps before writing Full", () => {
  const handler = fnBody(app("api/stripe/webhook/route.ts"), "completeTierUpgrade");
  const record = handler.indexOf("recordAccountPayment(");
  const swap = handler.indexOf("subscriptions.update(");
  const write = handler.indexOf('update({ subscription_tier: "full" })');
  assert.ok(record >= 0 && swap > record && write > swap, "record, then swap, then write Full");
  assert.match(handler, /proration_behavior:\s*"none"/, "the proration was the invoice just paid");
  assert.match(handler, /idempotencyKey:/);
});
