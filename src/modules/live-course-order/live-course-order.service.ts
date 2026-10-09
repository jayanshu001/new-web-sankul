// Live-course orders: checkout, payment verification and webhook fulfilment.
import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { extractPromoterAttribution } from "../order-code-snapshot/order-code-snapshot.service";
import { computeEndAt } from "../../utils/planDuration";
import { creditReferrer } from "../referral/credit-referrer";
import { debitWallet } from "../referral/debit-wallet";
// Shared with the package path so both book the course/material split identically.
import { computeMaterialSplit } from "../commerce-order/commerce-order.service";

/**
 * Live-course payment write path. The order owns payment, the subscription owns
 * entitlement, and one order = one subscription row: checkout writes a pending
 * `ws_live_course_order`; verify flips it to complete and creates a subscription
 * row. A renewal gets its own order and row, starting where the current
 * entitlement ends; it never folds onto the existing row.
 *
 * Legacy payment columns still exist on ws_live_course_subscription for old rows;
 * new writes do not touch them.
 *
 * plan.duration is in DAYS (the schema comment saying months is stale).
 *
 * The order table matches ws_package_course_order column for column:
 * `with_material` belongs to the plan, `updated_at` is the paid-at, and
 * `price` (Prisma `originalPrice`) is always written.
 */

export type LiveCourseVerifyDto = {
  _id: string;
  customerId: number;
  liveCourseId: number;
  planId: number | null;
  startAt: Date | null;
  endAt: Date | null;
  status: boolean;
  paidAmount: number | null;
  paymentStatus: string | null;
  razorpayOrderId: string | null;
  razorpayPaymentId: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
};

/**
 * Entitlement fields come from the subscription, payment fields from the order.
 * `paymentStatus` keeps the shipped vocabulary ("verified"), mapped from the
 * order's status, not renamed.
 *
 * `sub` is null only when an order is complete but its subscription is missing;
 * the DTO then carries the order's identity so the response stays well-formed.
 */
const ORDER_STATUS_TO_PAYMENT_STATUS: Record<string, string> = {
  pending: "pending",
  complete: "verified",
  // The wire value stays "failed"; 'failed' is kept as a key for older rows.
  cancel: "failed",
  failed: "failed",
};

const toVerifyDto = (sub: any | null, order: any): LiveCourseVerifyDto => ({
  _id: String(sub?.id ?? order.id),
  customerId: order.customerId,
  liveCourseId: order.liveCourseId,
  planId: order.planId ?? null,
  startAt: sub?.startAt ?? null,
  endAt: sub?.endAt ?? null,
  status: sub?.status ?? false,
  // `amount` is the charged amount (ws_live_course_order.discount_price).
  paidAmount: order.amount ?? null,
  paymentStatus: ORDER_STATUS_TO_PAYMENT_STATUS[order.status] ?? order.status ?? null,
  razorpayOrderId: order.razorpayOrderId ?? null,
  razorpayPaymentId: order.razorpayPaymentId ?? null,
  createdAt: sub?.createdAt ?? order.createdAt ?? null,
  updatedAt: sub?.updatedAt ?? order.updatedAt ?? null,
});

/** Null if missing or zero-price. */
export const findLiveCoursePlanForOrder = async (
  planId: number
): Promise<{ liveCourseId: number; price: number; duration: number; withMaterial: boolean; materialPrice: number | null } | null> => {
  const plan = await prisma.liveCoursePlan.findFirst({
    where: { id: planId, status: true },
    select: { liveCourseId: true, price: true, duration: true, withMaterial: true, materialPrice: true },
  });
  if (!plan || !plan.price || plan.price <= 0) return null;
  return {
    liveCourseId: plan.liveCourseId,
    price: plan.price,
    duration: plan.duration ?? 0,
    withMaterial: !!plan.withMaterial,
    materialPrice: plan.materialPrice ?? null,
  };
};

/** `status` lets create-order refuse a deactivated live course. */
export const findLiveCourse = (id: number) =>
  prisma.liveCourse.findFirst({ where: { id }, select: { id: true, name: true, status: true } });

export const listPlansForLiveCourse = (liveCourseId: number) =>
  prisma.liveCoursePlan.findMany({
    where: { liveCourseId, status: true },
    orderBy: [{ isDefault: "desc" }, { price: "asc" }, { id: "asc" }],
  });

/**
 * Prefers the stored `code_discount`; older rows fall back to deriving it as the
 * inverse of the legacy checkout write:
 *
 *   paid_amount = original_amount - discount - wallet_coin
 *
 * `original_amount` was set only when a promo applied, so NULL means no discount.
 * Wallet coin is redemption, not discount. Keep both paths: the admin
 * customer-details DTO still reads legacy subscription rows, and the receipt and
 * that DTO must stay byte-identical. If the write formula changes, change this too.
 */
export const liveSubDiscountAmount = (sub: {
  codeDiscount?: number | null;
  originalPrice?: number | null;
  amount?: number | null;
  wsCoin?: number | null;
  /** Legacy ws_live_course_subscription columns. */
  originalAmount?: number | null;
  paidAmount?: number | null;
  walletCoin?: number | null;
}): number => {
  if (sub.codeDiscount != null) return Number(sub.codeDiscount) > 0 ? Number(sub.codeDiscount) : 0;

  const original = sub.originalPrice ?? sub.originalAmount;
  if (original == null) return 0;
  const paid = sub.amount ?? sub.paidAmount;
  const coin = sub.wsCoin ?? sub.walletCoin;
  const discount = Number(original) - Number(paid ?? 0) - Number(coin ?? 0);
  // Clamp: a hand-edited or partially-refunded row must not report a negative discount.
  return discount > 0 ? discount : 0;
};

/**
 * Nothing is granted yet: no subscription row exists until payment verifies, so an
 * abandoned checkout leaves no unverified entitlement.
 */
export const createLiveCourseOrderMysql = async (input: {
  customerId: number;
  liveCourseId: number;
  planId: number;
  /** Charged amount (post-promo, post-coin) → `discount_price`. */
  amount: number;
  razorpayOrderId: string;
  /** Receipt id → `unique_id`. */
  uniqueId?: string | null;
  /** Full Razorpay order response, JSON string → `razorpay_order`. */
  razorpayOrderPayload?: string | null;
  /** Originating client IP → `ip_address` (utils/clientIp, clamped to the column). */
  ipAddress?: string | null;
  /** Referring customer id → `referrer_id`, denormalised from the snapshot. */
  referrerId?: number | null;
  /** Promo/referral discount in rupees → `code_discount`. 0 when no code. */
  codeDiscount?: number | null;
  /**
   * Purchase-time snapshots from `buildOrderCodeSnapshots({..., planKind:
   * "livePlan"})`, routed to exactly one column: promocode → `promocode`, customer
   * referral code → `refferalcode`. Both null when no code applied or the snapshot
   * could not be built; a snapshot never blocks a payment.
   */
  promocodeSnapshot?: unknown | null;
  refferalcodeSnapshot?: unknown | null;
  coin?: number | null;
  /** Plan list price → `price`; always written, as on ws_package_course_order. */
  originalAmount?: number | null;
  /**
   * Not persisted on the order (material is a plan property; verify re-reads it).
   * Accepted so the controller keeps one call shape.
   */
  withMaterial?: boolean;
  /** ws_customer_shipping.id → `shipping`. */
  customerShippingId?: number | null;
  now: Date;
}): Promise<{ orderId: number }> => {
  const order = await prisma.liveCourseOrder.create({
    data: {
      customerId: input.customerId,
      liveCourseId: input.liveCourseId,
      planId: input.planId,
      uniqueId: input.uniqueId ?? null,
      orderType: "purchase",
      amount: Math.round(input.amount),
      originalPrice: Math.round(input.originalAmount ?? input.amount),
      codeDiscount: Math.round(input.codeDiscount ?? 0),
      // DbNull, not null: Prisma writes a bare null as JSON `null`, which reports
      // would treat as a code; they read SQL NULL as "no code".
      promocode: (input.promocodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
      refferalcode: (input.refferalcodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
      referrerId: input.referrerId ?? null,
      wsCoin: input.coin ?? 0,
      paymentMethod: "online",
      status: "pending",
      shipping: input.customerShippingId ?? null,
      razorpayOrderId: input.razorpayOrderId,
      razorpayOrder: input.razorpayOrderPayload ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  return { orderId: order.id };
};

/**
 * Fallback for orders written while `referrer_id` was not a column. In the legacy
 * referral shape `promoter` holds the referring customer (not a ws_promoter). A
 * promocode snapshot yields null, so promocode purchases never credit anyone;
 * creditReferrer treats null as a no-op.
 */
const referrerIdOf = (row: { refferalcode: unknown }): number | null => {
  const ref = row.refferalcode as any;
  const id = ref && typeof ref === "object" ? ref.promoter?.id : null;
  return Number.isInteger(id) && id > 0 ? (id as number) : null;
};

/** Shared with test-series verify; the snapshot module owns both writing and reading the shape. */
const promoterAttribution = extractPromoterAttribution;

export const findLiveCourseOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
) => prisma.liveCourseOrder.findFirst({ where: { razorpayOrderId, customerId } });

/**
 * Idempotent: an order no longer "pending" returns its existing subscription.
 * Otherwise one transaction completes the order and creates a new subscription;
 * a renewal starts at the current entitlement's future endAt (else now) and
 * leaves that row alone. `duration` is in DAYS.
 */
export const verifyLiveCourseOrderMysql = async (
  order: any,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto> => {
  if (order.status && order.status !== "pending") {
    const existingSub = await prisma.liveCourseSubscription.findFirst({ where: { orderId: order.id } });
    return toVerifyDto(existingSub, order);
  }

  // `withMaterial` comes from the plan; the order table has no such column.
  const plan = await prisma.liveCoursePlan.findFirst({
    where: { id: order.planId ?? 0 },
    select: { duration: true, withMaterial: true, materialPrice: true },
  });
  const durationDays = plan?.duration ?? 0;
  const withMaterial = !!plan?.withMaterial;
  const amount = order.amount ?? 0;

  const material = computeMaterialSplit(amount, plan);
  // Entitled material kit, as findCoursePcMaterialId does on the package path.
  const liveCourseRow = await prisma.liveCourse.findFirst({
    where: { id: order.liveCourseId },
    select: { pcMaterialId: true },
  });
  const promoter = promoterAttribution(order);

  // Read only to place the new window. A lifetime grant (`endAt: null`) cannot be
  // continued from, so it falls through to `now`.
  const existingActive = await prisma.liveCourseSubscription.findFirst({
    where: {
      customerId: order.customerId,
      liveCourseId: order.liveCourseId,
      status: true,
      OR: [{ endAt: null }, { endAt: { gte: now } }],
    },
    orderBy: { endAt: "desc" },
  });
  const startAt =
    existingActive?.endAt && existingActive.endAt.getTime() > now.getTime()
      ? existingActive.endAt
      : now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });

  const sub = await prisma.$transaction(async (tx) => {
    // Claim: only a still-pending row flips. The loser of a concurrent /verify +
    // webhook matches 0 rows and writes nothing, so one order never yields two
    // subscriptions or two kit dispatches.
    const claim = await tx.liveCourseOrder.updateMany({
      where: { id: order.id, status: "pending" },
      // `updated_at` is the paid-at on order tables.
      data: { status: "complete", razorpayPaymentId, updatedAt: now },
    });
    if (claim.count === 0) return null;

    // Tracking row is created before the subscription so its id goes straight onto
    // the row (as verifyCourseTx does); that id is also the AWB. Only material
    // purchases get one. `orderId` here is the ORDER id, not the subscription id.
    const trackingRow = withMaterial
      ? await tx.liveCourseSubscriptionTracking.create({
          data: { orderId: order.id, status: "pending", created_at: now, updated_at: now },
        })
      : null;

    const created = await tx.liveCourseSubscription.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        liveCourseId: order.liveCourseId,
        planId: order.planId ?? null,
        startAt,
        endAt,
        status: true,
        // Stored on the entitlement row so dispatch and access checks stay row-local.
        withMaterial,
        shipping: order.shipping ?? null,
        tracking: trackingRow?.id ?? null,
        pcMaterialId: liveCourseRow?.pcMaterialId ?? null,
        // Mirrored off the order so subscription reports stand alone; course +
        // material always sums back to amount.
        amount,
        courseAmount: material.courseAmount,
        materialAmount: material.materialAmount,
        paidAmount: new Prisma.Decimal(amount),
        // A gateway id means the customer paid online; an admin grant writes "backend".
        payment_type: order.razorpayOrderId ? "online" : "backend",
        promoterId: promoter.promoterId,
        promoterPercentage:
          promoter.promoterPercentage != null ? new Prisma.Decimal(promoter.promoterPercentage) : null,
        createdAt: now,
        updatedAt: now,
      },
    });

    return created;
  });

  if (!sub) {
    // Lost the claim: the winner has committed (our UPDATE waited on its row lock),
    // so return what it produced.
    const fulfilled = await prisma.liveCourseOrder.findFirst({ where: { id: order.id } });
    const existingSub = await prisma.liveCourseSubscription.findFirst({ where: { orderId: order.id } });
    return toVerifyDto(existingSub, fulfilled ?? order);
  }

  // Keyed to the ORDER id. Both are idempotent and non-throwing, so neither can
  // block fulfilment.
  await creditReferrer({ referrerId: order.referrerId ?? referrerIdOf(order), buyerId: order.customerId, orderId: order.id, paidAmount: amount, source: "liveCourse" });
  await debitWallet({ customerId: order.customerId, orderId: order.id, coin: order.wsCoin, source: "liveCourse" });
  return toVerifyDto(sub, { ...order, status: "complete", razorpayPaymentId, updatedAt: now });
};

/**
 * Keyed by razorpayOrderId alone (the payload carries no customer). Safe to run
 * before or after /verify. Null if no order owns this id.
 */
export const fulfillLiveCourseWebhookMysql = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto | null> => {
  const order = await prisma.liveCourseOrder.findFirst({ where: { razorpayOrderId } });
  if (!order) return null;
  return verifyLiveCourseOrderMysql(order, razorpayPaymentId, now);
};
