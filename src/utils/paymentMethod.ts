/**
 * Payment-method display + reference resolution, shared by the PDF receipt
 * (libs/core/generate.ts) and the JSON receipt (client-purchase-history.service).
 *
 * Both used to answer "how was this paid?" differently — the PDF printed the raw
 * lowercase column, and the JSON hardcoded `"razorpay"` on four of its six
 * builders — so a bank transfer read as "razorpay" on the receipt screen and
 * "bank" on the PDF. One helper, one answer.
 */

/**
 * Display label for a stored `payment_method`.
 *
 * The PaymentMethod enum is mixed-case by accident of history — `bank`, `cash`,
 * `razorpay`, `free` are lowercase while `Backend`, `Paykun`, `Paytm` are
 * capitalised. Capitalising the first letter normalises every value without a
 * lookup table that would silently print a raw value the day a method is added.
 */
export const formatPaymentMethod = (raw?: string | null): string => {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
};

/**
 * `payment_type` (backend | online) is the ACTIVATION CHANNEL, not a payment
 * method — it is all a legacy order-less subscription carries. Map it to
 * something truthful rather than claiming a gateway that was never used.
 */
export const formatPaymentType = (raw?: string | null): string => {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "backend") return "Backend";
  if (v === "online") return "Online";
  return formatPaymentMethod(raw);
};

/**
 * The reference number to show, and what to call it.
 *
 * A gateway payment id only exists for online payments. Bank transfers are
 * settled manually and carry their reference in a separate column
 * (`bank_transaction_id`, or `transaction_id` on the ebook/test-series tables).
 *
 * Falls back across both columns rather than switching hard on the method: an
 * order can be recorded as `bank` and still carry a gateway id (or the reverse)
 * after a manual correction, and showing the id that actually exists is more
 * useful than showing nothing because the method column disagrees.
 */
export const resolvePaymentReference = (
  method: string,
  gatewayPaymentId?: string | null,
  bankTransactionId?: string | null,
): { paymentIdLabel: string; paymentId: string } => {
  const gateway = (gatewayPaymentId ?? "").trim();
  const bank = (bankTransactionId ?? "").trim();
  const isBank = method.toLowerCase() === "bank";
  const value = isBank ? bank || gateway : gateway || bank;
  return {
    // "Payment Id" is the gateway's language; a manual transfer has a
    // transaction reference, not a payment id.
    paymentIdLabel: isBank || (!gateway && bank) ? "Transaction Id" : "Payment Id",
    paymentId: value || "-",
  };
};
