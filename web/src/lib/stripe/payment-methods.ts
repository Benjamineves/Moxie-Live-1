/**
 * Payment methods for the TRANSFER FEE — immediate settlement only.
 *
 * WHY THE TRANSFER FEE IS RESTRICTED
 *
 * The transfer stays awaiting_payment until the webhook hears the payment
 * succeeded, and the seller can cancel it at any point before that. With
 * Stripe's automatic payment methods the Payment Element offered US bank
 * debit, which confirms as "processing" and settles days later. A seller
 * could pay by bank, cancel the transfer while it settled, and leave a
 * completed payment with nothing to complete — complete_ownership_transfer
 * refuses a cancelled transfer on every delivery, and the only resolution
 * is a manual refund.
 *
 * With card only, the payment has succeeded or failed by the time
 * confirmPayment returns, so there is no multi-day window. 'card' includes
 * Apple Pay and Google Pay, which Stripe treats as cards.
 *
 * LINK. Naming only 'card' is not enough on the form: Stripe's Link rides
 * along with card and, when enabled on the account, offers its own "Bank"
 * and "Klarna" options inside the Payment Element — seen in testing. A
 * bank-funded Link payment settles later. The intent's card-only list is
 * the guarantee (a Link payment method is not a card), and the form also
 * passes wallets: { link: "never" } so it never offers what the intent
 * would refuse.
 *
 * WHAT WAS DROPPED, deliberately conservative: Cash App Pay, Amazon Pay,
 * Klarna, Affirm and Link were also on offer. Some of those likely settle
 * immediately too, but "likely" is not the bar for a list whose whole
 * purpose is a settlement guarantee. Add one back only after confirming in
 * Stripe's documentation that it can never sit in 'processing'.
 *
 * ONE LIST, TWO USERS. Elements (TransferPaymentForm) and the PaymentIntent
 * (createTransferFeeIntent) must name exactly the same methods — Stripe
 * rejects a deferred-mode confirmation whose intent does not match the
 * Elements configuration — so both import this. No imports of its own, so
 * the client component can use it without pulling in the Stripe server SDK.
 */
export const TRANSFER_FEE_PAYMENT_METHOD_TYPES = ["card"] as const;

/**
 * Methods known to confirm as 'processing' and settle later. Not used to
 * build anything — it exists so the test can assert the transfer fee list
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
