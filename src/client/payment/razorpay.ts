// Razorpay: shared client, order creation and checkout response helpers.
import Razorpay from "razorpay";
import { callOutbound } from "../../libs/outbound";

// Create-order echoes the app never reads (it only round-trips the razorpay order
// id to /verify); omitted at each handler's edge. Verify no web/analytics consumer
// reads them before enabling in prod.
export const PAYMENT_ORDER_ECHO_KEYS = [
  "bookOrderId", "ebookOrderId", "testSeriesOrderId", "subscriptionId", "receiptId",
  "course", "ebook", "package", "liveCourse", "testSeries", "plan", "promo",
] as const;

let cached: Razorpay | null = null;

// Returns null when creds are missing instead of throwing, so the server still
// boots without Razorpay; callers answer 500.
export const getRazorpay = (): Razorpay | null => {
  if (cached) return cached;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  // Diagnostic: prints lengths only, never values. Remove once payments are stable.
  console.log(
    "[razorpay] init keyId.len=%d secret.len=%d keyId.prefix=%s",
    key_id?.length ?? 0,
    key_secret?.length ?? 0,
    key_id ? key_id.slice(0, 8) : "<missing>"
  );
  if (!key_id || !key_secret) return null;
  cached = new Razorpay({ key_id, key_secret });
  return cached;
};

/**
 * Razorpay `orders.create` behind the standard timeout + retry + circuit-breaker:
 * a hung create() would otherwise pin a request slot until Node's 10-min socket
 * timeout. Each attempt is capped at 6s with backoff on 429/5xx. Retries are safe
 * because Razorpay treats `receipt` as the idempotency key; callers must pass a stable one.
 */
export const createRazorpayOrder = async (
  rp: Razorpay,
  params: Parameters<Razorpay["orders"]["create"]>[0]
) =>
  callOutbound(() => rp.orders.create({ ...params, payment_capture: true }) as Promise<any>, {
    label: "razorpay.orders.create",
    timeoutMs: 6_000,
    attempts: 3,
  });

// Response shape the mobile SDK expects, identical across purchase types.
// Always paise; currency is INR only.
export const razorpayResponseFor = (rzpOrder: {
  id: string;
  amount: number | string;
  currency: string;
}) => ({
  orderId: rzpOrder.id,
  keyId: process.env.RAZORPAY_KEY_ID,
  amount: rzpOrder.amount,
  currency: rzpOrder.currency,
});
