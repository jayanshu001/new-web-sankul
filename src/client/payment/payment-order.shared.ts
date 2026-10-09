// Client payments: the steps every create-order handler shares (customer + Razorpay
// prologue, promo re-validation, wallet coins, shipping snapshot, error tail). Each
// handler keeps its own flow, step order and response keys; only the copies live here.
import { Request, Response } from "express";
import { z, ZodError } from "zod";
import logger from "../../utils/logger";
import { getErrorMessage, formatZodError } from "../../utils/httpResponse";
import { resolvePromoForPlanSql } from "../../modules/promo-code/promo-code.service";
import { resolveWalletUsage } from "../../modules/referral/referral.service";
import { resolveShippingIdForAddress } from "../../modules/customer-shipping/customer-shipping.service";
import { getRazorpay } from "./razorpay";

export type RazorpayClient = NonNullable<ReturnType<typeof getRazorpay>>;
/** `name` is the handler name used as the log prefix. */
export type PaymentCtx = { name: string; traceId?: string; customerId: number };

export const planIdField = (message: string) =>
  z.coerce.number({ invalid_type_error: message }).int(message).positive(message);
export const shippingIdField = planIdField("Please select a valid delivery address.").optional();
export const promocodeField = z.string().trim().min(1, "Promo code cannot be empty. Remove it or enter a valid code.").optional();
export const coinField = z.coerce
  .number({ invalid_type_error: "Coins to redeem must be a whole number." })
  .int("Coins to redeem must be a whole number.")
  .min(0, "Coins to redeem cannot be negative.")
  .optional();

const fail = (res: Response, status: number, message: string) => {
  res.status(status).json({ success: false, message });
  return null;
};

// 401 without a user, 500 when Razorpay is unconfigured, 400 for a non-int token
// subject (the order tables key on the int customer id). Null = already responded.
export const requirePaymentCustomer = (req: Request, res: Response, name: string): (PaymentCtx & { rp: RazorpayClient }) | null => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  if (!customerId) { logger.warn(`${name} unauthorized`, { traceId }); return fail(res, 401, "Unauthorized."); }
  const rp = getRazorpay();
  if (!rp) {
    logger.error(`${name} razorpay not configured`, { traceId, customerId });
    return fail(res, 500, "Razorpay credentials not configured on the server.");
  }
  const customerIdInt = Number(customerId);
  if (!Number.isInteger(customerIdInt)) {
    logger.warn(`${name} non-int customer id`, { traceId, customerId });
    return fail(res, 400, "Invalid customer id.");
  }
  return { name, traceId, customerId: customerIdInt, rp };
};

// The request carries an address-book id (ws_customer_address), but the order's
// `shipping` column is an FK to ws_customer_shipping, so the address is snapshotted
// into a shipping row and that id persisted. Resolving also proves ownership
// (not-found covers unknown, soft-deleted and other customers' ids).
export const resolveOrderShipping = async (res: Response, ctx: PaymentCtx, addressId: number | undefined): Promise<{ shippingId: number | null } | null> => {
  if (!addressId) return { shippingId: null };
  const resolved = await resolveShippingIdForAddress(ctx.customerId, addressId);
  if (resolved.ok) return { shippingId: resolved.shippingId };
  logger.warn(`${ctx.name} shipping resolve failed`, { traceId: ctx.traceId, customerId: ctx.customerId, customerShippingId: addressId, reason: resolved.reason });
  return fail(res, 400, resolved.reason === "address_not_found"
    ? "Delivery address does not belong to this customer."
    : "Delivery address is incomplete. Please update it and try again.");
};

export type PromoApplied = {
  chargeAmount: number;
  promocodeIdNum: number | null;
  originalAmount: number | null;
  discountAmount: number | null;
  /** Set when the code was a referral code, so verify can credit the referrer. */
  referrerIdNum: number | null;
};

// Re-validated here; the /promocodes/apply preview is never trusted.
export const applyOrderPromo = async (
  res: Response,
  ctx: PaymentCtx,
  promocode: string | undefined,
  listPrice: number,
  entity: Parameters<typeof resolvePromoForPlanSql>[2],
  planId: number
): Promise<PromoApplied | null> => {
  const none: PromoApplied = { chargeAmount: listPrice, promocodeIdNum: null, originalAmount: null, discountAmount: null, referrerIdNum: null };
  if (!promocode) return none;
  const { result, error } = await resolvePromoForPlanSql(promocode, listPrice, entity, planId, ctx.customerId);
  if (error || !result) {
    logger.warn(`${ctx.name} promo rejected`, { traceId: ctx.traceId, customerId: ctx.customerId, promocode, error });
    return fail(res, 400, error ?? "Invalid promo code.");
  }
  if (result.finalAmount < 1) return fail(res, 400, "This promo code reduces the price below the minimum payable amount. Please contact support.");
  const pid = Number(String(result.promo._id));
  return {
    chargeAmount: result.finalAmount,
    promocodeIdNum: Number.isInteger(pid) && pid > 0 ? pid : null,
    originalAmount: result.originalAmount,
    discountAmount: result.discountAmount,
    referrerIdNum: result.referrerId ?? null,
  };
};

// Wallet coins: validated against balance + the 50%-of-plan-price cap, then taken off
// the charge. The debit itself happens at verify, so the order stores the coin amount.
export const applyOrderWallet = async (
  res: Response,
  ctx: PaymentCtx,
  coin: number | undefined,
  listPrice: number,
  chargeAmount: number
): Promise<{ coin: number; chargeAmount: number } | null> => {
  const walletUsage = await resolveWalletUsage(ctx.customerId, coin, listPrice);
  if (walletUsage.error) {
    logger.warn(`${ctx.name} wallet rejected`, { traceId: ctx.traceId, customerId: ctx.customerId, coin, error: walletUsage.error });
    return fail(res, 400, walletUsage.error);
  }
  if (walletUsage.coin > 0) {
    chargeAmount = chargeAmount - walletUsage.coin;
    if (chargeAmount < 1) return fail(res, 400, "Amount after discount and wallet is below the minimum payable. Please reduce wallet usage.");
  }
  return { coin: walletUsage.coin, chargeAmount };
};

export const receiptIdFor = (prefix: string, nowMs: number = Date.now()) =>
  `${prefix}-${nowMs}-${Math.random().toString(36).slice(2, 8)}`;

// `finalAmount` is what is actually charged, i.e. after wallet coins too.
export const promoEcho = (p: PromoApplied, finalAmount: number) =>
  p.promocodeIdNum
    ? { promocodeId: String(p.promocodeIdNum), originalAmount: p.originalAmount, discountAmount: p.discountAmount, finalAmount }
    : null;

// 400 with the flat Zod message/errors, else 500 carrying Razorpay's own description when
// it has one. Used by package / live-course / test-series only: course and ebook have
// always let errors reach errorHandler, and their clients parse that envelope.
export const createOrderFailure = (res: Response, e: any, name: string, traceId: string | undefined, customerId: unknown) => {
  if (e instanceof ZodError) {
    logger.warn(`${name} validation failed`, { traceId, customerId, issues: e.issues });
    const { message, errors } = formatZodError(e);
    return res.status(400).json({ success: false, message, errors });
  }
  logger.error(`${name} failed`, { traceId, customerId, error: e?.error?.description || getErrorMessage(e), stack: e?.stack });
  return res.status(500).json({ success: false, message: e?.error?.description || "Something went wrong while creating your order. Please try again." });
};
