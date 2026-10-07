// Payment method: receipt display labels and payment reference resolution.
/**
 * Payment-method display + reference resolution, shared by the PDF receipt and
 * the JSON receipt so both describe a payment the same way.
 */

/**
 * The PaymentMethod enum is mixed-case (`bank` vs `Paytm`); capitalising the first
 * letter normalises every value, including methods added later.
 */
export const formatPaymentMethod = (raw?: string | null): string => {
  const v = (raw ?? "").trim();
  if (!v) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
};

/**
 * `payment_type` (backend | online) is the activation channel, not a payment
 * method; it is all a legacy order-less subscription carries.
 */
export const formatPaymentType = (raw?: string | null): string => {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "backend") return "Backend";
  if (v === "online") return "Online";
  return formatPaymentMethod(raw);
};

/**
 * The reference number to show, and its label. Bank transfers carry their
 * reference in `bank_transaction_id` (`transaction_id` on ebook/test-series).
 * Falls back across both columns because manual corrections can leave the
 * method column disagreeing with which id actually exists.
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
    paymentIdLabel: isBank || (!gateway && bank) ? "Transaction Id" : "Payment Id",
    paymentId: value || "-",
  };
};
