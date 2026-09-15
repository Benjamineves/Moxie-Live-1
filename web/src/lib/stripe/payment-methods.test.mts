import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DELAYED_SETTLEMENT_PAYMENT_METHOD_TYPES, IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES } from "./payment-methods.ts";

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../app/${path}`, import.meta.url)), "utf8");

/**
 * Every checkout, its server action, and its form. The bundle's intent comes
 * from a subscription's first invoice, so its methods are set in
 * payment_settings rather than on an intent.
 */
const CHECKOUTS = [
  { name: "transfer fee", action: "dashboard/transfer/[transferId]/payment/actions.ts", form: "dashboard/transfer/[transferId]/payment/TransferPaymentForm.tsx" },
  { name: "badge fee", action: "dashboard/[mxeId]/payment/actions.ts", form: "dashboard/[mxeId]/payment/PaymentForm.tsx" },
  { name: "signup bundle", action: "dashboard/[mxeId]/payment/actions.ts", form: "dashboard/[mxeId]/payment/SignupBundleForm.tsx" },
  { name: "plan picker", action: "dashboard/upgrade/actions.ts", form: "dashboard/upgrade/UpgradeForm.tsx" },
  { name: "Basic to Full upgrade", action: "dashboard/upgrade/actions.ts", form: "dashboard/upgrade/UpgradeToFullForm.tsx" },
];

const LIST = /payment_method_types:\s*\[\.\.\.IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES\]/;

test("the checkout list contains no delayed-settlement payment method", () => {
  const delayed = new Set<string>(DELAYED_SETTLEMENT_PAYMENT_METHOD_TYPES);
  for (const method of IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES) {
    assert.ok(!delayed.has(method), `${method} settles later — state can change while it is processing`);
  }
});

test("no checkout action uses automatic payment methods", () => {
  // Automatic payment methods follow the Stripe dashboard, so a method
  // enabled there — bank debit was — would silently reappear.
  for (const { name, action } of CHECKOUTS) {
    // The property, not the word — comments explaining why it is absent may name it.
    assert.doesNotMatch(source(action), /automatic_payment_methods\s*:/, `${name}: must not use automatic_payment_methods`);
  }
});

test("each checkout action names the shared list on what it creates", () => {
  const badgeAndBundle = source("dashboard/[mxeId]/payment/actions.ts");
  // Badge fee: on the PaymentIntent. Bundle: on the subscription's payment_settings.
  const uses = badgeAndBundle.match(new RegExp(LIST.source, "g")) ?? [];
  assert.equal(uses.length, 2, "badge fee intent and bundle subscription must both name the list");
  assert.match(badgeAndBundle, /payment_settings:\s*\{[^}]*payment_method_types:\s*\[\.\.\.IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES\]/);
  assert.match(source("dashboard/transfer/[transferId]/payment/actions.ts"), LIST);
  // Plan picker (the subscription) and Basic to Full (the upgrade invoice): both in payment_settings.
  const upgradeUses =
    source("dashboard/upgrade/actions.ts").match(
      /payment_settings:\s*\{[^}]*payment_method_types:\s*\[\.\.\.IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES\]/g,
    ) ?? [];
  assert.equal(upgradeUses.length, 2, "plan picker subscription and upgrade invoice must both name the list");
});

test("each checkout form mounts Elements with the same list, and without Link", () => {
  for (const { name, form } of CHECKOUTS) {
    const text = source(form);
    // Elements and the intent must agree, or Stripe rejects the confirmation.
    assert.match(text, /paymentMethodTypes:\s*\[\.\.\.IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES\]/, `${name}: Elements list`);
    // Card alone still let Link offer bank-funded payments inside the element.
    assert.match(text, /wallets:\s*\{\s*link:\s*"never"\s*\}/, `${name}: Link must be off`);
  }
});

test("each checkout form mounts deferred and creates its intent only at the Pay click", () => {
  // Creating the intent (or subscription) on page load or plan choice is
  // what let checks be defeated by opening several pages, and what left an
  // incomplete subscription behind on every plan change.
  for (const { name, form, action } of CHECKOUTS) {
    const text = source(form);
    const elements = text.match(/<Elements[\s\S]*?>/)?.[0] ?? "";
    assert.match(elements, /mode:\s*"(payment|subscription)"/, `${name}: Elements must mount in deferred mode`);
    assert.doesNotMatch(elements, /clientSecret/, `${name}: Elements must not be given an intent's client secret`);

    const actionNames = [...source(action).matchAll(/export async function (\w+)/g)].map((m) => m[1]);
    const called = actionNames.filter((fn) => new RegExp(`\\b${fn}\\(`).test(text));
    assert.equal(called.length, 1, `${name}: form should call exactly one creating action, found ${called.join(", ")}`);
    const calls = [...text.matchAll(new RegExp(`\\b${called[0]}\\(`, "g"))];
    assert.equal(calls.length, 1, `${name}: ${called[0]} must be called from one place only`);
    const submitAt = text.indexOf("await elements.submit()");
    assert.ok(submitAt >= 0, `${name}: submit handler must validate with elements.submit()`);
    assert.ok(calls[0].index! > submitAt, `${name}: ${called[0]} must be called after elements.submit(), in the Pay handler`);
  }
});
