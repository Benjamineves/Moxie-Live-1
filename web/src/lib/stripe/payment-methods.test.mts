import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { DELAYED_SETTLEMENT_PAYMENT_METHOD_TYPES, TRANSFER_FEE_PAYMENT_METHOD_TYPES } from "./payment-methods.ts";

const transferPayment = (file: string) =>
  readFileSync(fileURLToPath(new URL(`../../app/dashboard/transfer/[transferId]/payment/${file}`, import.meta.url)), "utf8");

test("the transfer fee accepts no delayed-settlement payment method", () => {
  const delayed = new Set<string>(DELAYED_SETTLEMENT_PAYMENT_METHOD_TYPES);
  for (const method of TRANSFER_FEE_PAYMENT_METHOD_TYPES) {
    assert.ok(!delayed.has(method), `${method} settles later — a seller could cancel while it is processing`);
  }
});

test("the transfer fee intent names its methods instead of using automatic payment methods", () => {
  // Automatic payment methods follow the Stripe dashboard, so a method
  // enabled there — bank debit was — would silently reappear on this fee.
  const action = transferPayment("actions.ts");
  // The property, not the word — comments explaining why it is absent may name it.
  assert.doesNotMatch(action, /automatic_payment_methods\s*:/, "createTransferFeeIntent must not use automatic_payment_methods");
  assert.match(action, /payment_method_types:\s*\[\.\.\.TRANSFER_FEE_PAYMENT_METHOD_TYPES\]/);
});

test("the transfer payment form mounts Elements with the same list, and without Link", () => {
  const form = transferPayment("TransferPaymentForm.tsx");
  // Elements and the intent must agree, or Stripe rejects the confirmation.
  assert.match(form, /paymentMethodTypes:\s*\[\.\.\.TRANSFER_FEE_PAYMENT_METHOD_TYPES\]/);
  // Card alone still let Link offer bank-funded payments inside the element.
  assert.match(form, /wallets:\s*\{\s*link:\s*"never"\s*\}/);
});
