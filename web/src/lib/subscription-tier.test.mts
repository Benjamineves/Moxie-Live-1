import { test } from "node:test";
import assert from "node:assert/strict";
import type Stripe from "stripe";
import { accountUpdateForActiveSubscription, tierForPaidInvoice } from "./subscription-tier.ts";

// Real test-mode ids, read from Stripe on 2026-09-15.
const BASIC = "price_1UBJBvF2ijdqsFlLI53vIrU5";
const FULL = "price_1U8lmnF2ijdqsFlLiI4xOCjq";
const BADGE = "price_1UBJHvF2ijdqsFlLWBUzpfeM";
process.env.STRIPE_PRICE_ID_BASIC_SUBSCRIPTION = BASIC;
process.env.STRIPE_PRICE_ID_FULL = FULL;

const SUB = "sub_1UBJeTF2ijdqsFlLZ7sdkun1";
const ITEM = "si_VBh28lBOQfvWEG";

/**
 * sub_1UBJeT… as Stripe holds it: active, item swapped to the Full price
 * (2 Sept 20:43), pending_update null, the two proration items for that
 * swap never invoiced, latest_invoice still the paid Basic signup.
 */
const sub1UBJeT = {
  id: SUB,
  object: "subscription",
  status: "active",
  customer: "cus_VBKCk0O21i3eMm",
  pending_update: null,
  latest_invoice: "in_1UBJeTF2ijdqsFlLUK6ntfFp",
  items: { object: "list", data: [{ id: ITEM, price: { id: FULL } }] },
} as unknown as Stripe.Subscription;

type Line = { amount: number; price: string; proration: boolean; kind?: "subscription_item" | "invoice_item" };

function invoice(id: string, billing_reason: string, lines: Line[]): Stripe.Invoice {
  return {
    id,
    object: "invoice",
    billing_reason,
    status: "paid",
    parent: { type: "subscription_details", subscription_details: { subscription: SUB } },
    lines: {
      object: "list",
      has_more: false,
      data: lines.map((l, i) => ({
        id: `il_${i}`,
        amount: l.amount,
        pricing: { type: "price_details", price_details: { price: l.price } },
        parent:
          (l.kind ?? "subscription_item") === "subscription_item"
            ? {
                type: "subscription_item_details",
                subscription_item_details: { proration: l.proration, subscription: SUB, subscription_item: ITEM },
                invoice_item_details: null,
              }
            : {
                type: "invoice_item_details",
                invoice_item_details: { proration: l.proration, subscription: SUB, invoice_item: `ii_${i}` },
                subscription_item_details: null,
              },
      })),
    },
  } as unknown as Stripe.Invoice;
}

/** in_1UBJeT…: the paid signup — badge fee plus the Basic plan. */
const signupInvoice = invoice("in_1UBJeTF2ijdqsFlLUK6ntfFp", "subscription_create", [
  { amount: 2900, price: BADGE, proration: false, kind: "invoice_item" },
  { amount: 5900, price: BASIC, proration: false },
]);

test("sub_1UBJeT: a subscription update carrying the Full price with its proration unpaid does not produce Full", () => {
  // What the webhook writes on the swap's customer.subscription.updated.
  const update: Record<string, unknown> = accountUpdateForActiveSubscription();
  assert.notEqual(update.subscription_tier, "full");
});

test("sub_1UBJeT: its paid Basic signup invoice, delivered after the swap, does not produce Full", () => {
  assert.equal(tierForPaidInvoice(signupInvoice, sub1UBJeT), "basic");
});

test("a subscription status event never writes a tier at all", () => {
  assert.deepEqual(accountUpdateForActiveSubscription(), { subscription_status: "active" });
});

const latest = (inv: Stripe.Invoice) => ({ ...sub1UBJeT, latest_invoice: inv.id }) as unknown as Stripe.Subscription;

test("a paid proration invoice is Full: the tier whose remaining time was charged", () => {
  // in_1UBLP4… (sub_1UBKTY…, 2 Sept 21:09), paid $89.99.
  const proration = invoice("in_1UBLP4F2ijdqsFlLQ2ivMmMc", "manual", [
    { amount: -14898, price: FULL, proration: true },
    { amount: 14898, price: FULL, proration: true },
    { amount: -5900, price: BASIC, proration: true },
    { amount: 14899, price: FULL, proration: true },
  ]);
  assert.equal(tierForPaidInvoice(proration, latest(proration)), "full");
});

test("a renewal is the tier of its plan line, whatever prorations it swept up", () => {
  const renewal = invoice("in_renewal", "subscription_cycle", [
    { amount: -5899, price: BASIC, proration: true, kind: "invoice_item" },
    { amount: 14898, price: FULL, proration: true, kind: "invoice_item" },
    { amount: 5900, price: BASIC, proration: false },
  ]);
  assert.equal(tierForPaidInvoice(renewal, latest(renewal)), "basic");
  const fullRenewal = invoice("in_full_renewal", "subscription_cycle", [
    { amount: -5899, price: BASIC, proration: true, kind: "invoice_item" },
    { amount: 14898, price: FULL, proration: true, kind: "invoice_item" },
    { amount: 14900, price: FULL, proration: false },
  ]);
  assert.equal(tierForPaidInvoice(fullRenewal, latest(fullRenewal)), "full");
});

test("an invoice with no plan line, or plan lines that disagree, decides nothing", () => {
  const badgeOnly = invoice("in_badge", "manual", [{ amount: 2900, price: BADGE, proration: false, kind: "invoice_item" }]);
  assert.equal(tierForPaidInvoice(badgeOnly, latest(badgeOnly)), null);
  const both = invoice("in_both", "subscription_cycle", [
    { amount: 5900, price: BASIC, proration: false },
    { amount: 14900, price: FULL, proration: false },
  ]);
  assert.equal(tierForPaidInvoice(both, latest(both)), null);
});

test("an older invoice delivered after a newer one decides nothing", () => {
  // A Basic renewal redelivered after a paid upgrade became the latest invoice.
  const renewal = invoice("in_old_renewal", "subscription_cycle", [{ amount: 5900, price: BASIC, proration: false }]);
  const afterUpgrade = { ...sub1UBJeT, latest_invoice: "in_upgrade" } as unknown as Stripe.Subscription;
  assert.equal(tierForPaidInvoice(renewal, afterUpgrade), null);
});
