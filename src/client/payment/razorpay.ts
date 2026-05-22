import Razorpay from "razorpay";
import { callOutbound } from "../../libs/outbound";

let cached: Razorpay | null = null;

// Returns a Razorpay client built from env, or null if creds are missing.
// We deliberately do not throw at import time — the server should still boot
// without Razorpay so unrelated dev work isn't blocked. Callers handle null
// by returning a clear 500 to the client.
export const getRazorpay = (): Razorpay | null => {
  if (cached) return cached;
  const key_id = process.env.RAZORPAY_KEY_ID;
  const key_secret = process.env.RAZORPAY_KEY_SECRET;
  // Diagnostic: prints lengths only (never values). Confirms the running
  // process picked up .env. Remove once payments are stable.
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
 * Wrap Razorpay's `orders.create` (and any other outbound Razorpay call) in
 * the standard timeout + retry + circuit-breaker. Centralized here so every
 * payment controller picks up the protection without per-callsite plumbing.
 *
 * Why this matters: Razorpay's order-create occasionally times out under
 * load; the legacy callers had no timeout, so a single hung create() would
 * pin a request slot until Node's default 10-min socket timeout. With
 * callOutbound we cap each attempt at 6s and back off on 429/5xx.
 *
 * Idempotency: Razorpay treats `receipt` as the idempotency key, so retries
 * with the same receipt either return the existing order or create one —
 * never duplicate. Callers should supply a stable `receipt` (most already do).
 */
export const createRazorpayOrder = async (
  rp: Razorpay,
  params: Parameters<Razorpay["orders"]["create"]>[0]
) =>
  callOutbound(() => rp.orders.create(params) as Promise<any>, {
    label: "razorpay.orders.create",
    timeoutMs: 6_000,
    attempts: 3,
  });

// Build the response shape the mobile SDK expects, identical across purchase
// types (book cart / course / ebook). Always paise. Currency hard-coded to INR
// for now — change here if/when we go multi-currency.
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
