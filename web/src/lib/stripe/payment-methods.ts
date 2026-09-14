/**
 * Payment methods for EVERY CHECKOUT — immediate settlement only.
 *
 * WHY EVERY CHECKOUT IS RESTRICTED
 *
 * Each checkout pays for something that stays unfinished until the webhook
 * hears the payment succeeded, and each has state that can change in the
 * meantime. With Stripe's automatic payment methods the Payment Element
 * offered US bank debit, which confirms as "processing" and settles days
 * later — long enough for that state to move underneath the payment:
 *
 *  - Transfer fee: the transfer stays awaiting_payment, and the seller can
 *    cancel it. The settled payment then has no transfer to complete, and
 *    complete_ownership_transfer refuses it on every delivery. Manual
 *    refund.
 *  - Badge fee: the vessel stays pending_payment, so the payment page still
 *    offers checkout and the dashboard still says it needs paying. Paying
 *    again charged twice.
 *  - Signup bundle: the subscription stays incomplete while its first
 *    invoice settles, and a second Pay click cancels an incomplete
 *    subscription to start a new one — cancelling the plan being paid for.
 *
 * With card only, the payment has succeeded or failed by the time
 * confirmPayment returns, so none of those windows exist. 'card' includes
 * Apple Pay and Google Pay, which Stripe treats as cards.
 *
 * LINK. Naming only 'card' is not enough on the form: Stripe's Link rides
 * along with card and, when enabled on the account, offers its own "Bank"
 * and "Klarna" options inside the Payment Element — seen in testing. A
 * bank-funded Link payment settles later. The intent's card-only list is
 * the guarantee (a Link payment method is not a card), and every form also
 * passes wallets: { link: "never" } so it never offers what the intent
 * would refuse.
 *
 * WHAT WAS DROPPED, deliberately conservative: Cash App Pay, Amazon Pay,
 * Klarna, Affirm and Link were also on offer. Some of those likely settle
 * immediately too, but "likely" is not the bar for a list whose whole
 * purpose is a settlement guarantee. Add one back only after confirming in
 * Stripe's documentation that it can never sit in 'processing'.
 *
 * ONE LIST, EVERY USER. Each form's Elements and the intent (or, for the
 * bundle, the subscription's payment_settings) behind it must name exactly
 * the same methods — Stripe rejects a deferred-mode confirmation whose
 * intent does not match the Elements configuration — so all of them import
 * this. No imports of its own, so client components can use it without
 * pulling in the Stripe server SDK.
 */
export const IMMEDIATE_SETTLEMENT_PAYMENT_METHOD_TYPES = ["card"] as const;

/**
 * Methods known to confirm as 'processing' and settle later. Not used to
 * build anything — it exists so the test can assert the checkout list
 * never contains one of them.
 */
export const DELAYED_SETTLEMENT_PAYMENT_METHOD_TYPES = [
  "us_bank_account",
  "sepa_debit",
  "bacs_debit",
  "au_becs_debit",
  "acss_debit",
  "customer_balance",
  "boleto",
  "oxxo",
  "konbini",
  "multibanco",
] as const;
