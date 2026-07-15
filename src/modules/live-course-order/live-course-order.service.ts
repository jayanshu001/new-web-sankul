import { prisma } from "../../config/prisma";
import { computeEndAt, extendEndAt } from "../../utils/planDuration";
import { creditReferrer } from "../../client/referral/credit-referrer";
import { debitWallet } from "../../client/referral/debit-wallet";

/**
 * Live-course payment write path on SQL (Wave 7). UNLIKE course/package, the
 * live-course design is SINGLE-TABLE — `ws_live_course_subscription` carries BOTH
 * the payment fields (razorpay ids, payment_status) AND the entitlement (start/end,
 * status). So there is no separate order table: createPending writes a pending
 * subscription row; verify flips it to verified (or folds onto an existing active
 * sub and retires this row's window via extend).
 *
 * ⚠ plan.duration is DAYS (per the live-course controllers + admin-live-course
 * grant — computeEndAt asDays:true). The schema comment saying MONTHS is stale;
 * DAYS is the shipped precedent. See [[project_plan_duration_unit]].
 * withMaterial / customerShippingId are now persisted on the SQL subscription
 * (ws_live_course_subscription.with_material / customer_shipping_id). withMaterial
 * is derived from the selected plan's flag; customerShippingId is the delivery
 * address chosen at checkout (validated for ownership in the controller).
 */
export const LIVE_COURSE_ORDER_MODULE = "live-course-order";
export const isLiveCourseOrderMysql = (): boolean => true;

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

const toVerifyDto = (s: any): LiveCourseVerifyDto => ({
  _id: String(s.id),
  customerId: s.customerId,
  liveCourseId: s.liveCourseId,
  planId: s.planId ?? null,
  startAt: s.startAt ?? null,
  endAt: s.endAt ?? null,
  status: s.status,
  paidAmount: s.paidAmount ?? null,
  paymentStatus: s.paymentStatus ?? null,
  razorpayOrderId: s.razorpayOrderId ?? null,
  razorpayPaymentId: s.razorpayPaymentId ?? null,
  createdAt: s.createdAt ?? null,
  updatedAt: s.updatedAt ?? null,
});

/** Read a live-course plan for create-order. Returns null if missing/zero-price. */
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

/** Minimal live-course lookup (id + name) for SQL order responses. */
export const findLiveCourse = (id: number) =>
  prisma.liveCourse.findFirst({ where: { id }, select: { id: true, name: true } });

/** All active pricing plans for a live course (apply-promo plan list). */
export const listPlansForLiveCourse = (liveCourseId: number) =>
  prisma.liveCoursePlan.findMany({
    where: { liveCourseId, status: true },
    orderBy: [{ isDefault: "desc" }, { price: "asc" }, { id: "asc" }],
  });

/**
 * Create a pending live-course subscription row + return its id. The razorpay
 * order id is set on the row immediately (single-table — no order row to bridge).
 */
export const createLiveCourseOrderMysql = async (input: {
  customerId: number;
  liveCourseId: number;
  planId: number;
  amount: number;
  razorpayOrderId: string;
  promocodeId?: number | null;
  referrerId?: number | null;
  coin?: number | null;
  originalAmount?: number | null;
  discountAmount?: number | null;
  withMaterial?: boolean;
  customerShippingId?: number | null;
  now: Date;
}): Promise<{ subscriptionId: number }> => {
  const sub = await prisma.liveCourseSubscription.create({
    data: {
      customerId: input.customerId,
      liveCourseId: input.liveCourseId,
      planId: input.planId,
      paidAmount: Math.round(input.amount),
      originalAmount: input.originalAmount != null ? Math.round(input.originalAmount) : null,
      discountAmount: input.discountAmount != null ? Math.round(input.discountAmount) : null,
      promocodeId: input.promocodeId ?? null,
      referrerId: input.referrerId ?? null,
      walletCoin: input.coin ?? null,
      paymentStatus: "pending",
      status: true,
      withMaterial: !!input.withMaterial,
      customerShippingId: input.customerShippingId ?? null,
      razorpayOrderId: input.razorpayOrderId,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  return { subscriptionId: sub.id };
};

/** Owner lookup for verify (the pending sub owning this razorpay order id). */
export const findLiveCourseOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
) => prisma.liveCourseSubscription.findFirst({ where: { razorpayOrderId, customerId } });

/**
 * Verify fulfillment. Idempotent: if already verified, returns the row as-is.
 * If the customer has another active sub for this live course, FOLD this purchase
 * onto it (extend endAt by plan duration DAYS, sum paid) and retire this pending
 * row (mark verified but it carries no fresh window). Else flip this row to a
 * fresh verified grant (start=now, end=now+durationDays).
 */
export const verifyLiveCourseOrderMysql = async (
  pending: any,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto> => {
  if (pending.paymentStatus && pending.paymentStatus !== "pending") {
    return toVerifyDto(pending); // idempotent
  }
  const plan = await prisma.liveCoursePlan.findFirst({
    where: { id: pending.planId ?? 0 },
    select: { duration: true },
  });
  const durationDays = plan?.duration ?? 0;
  const amount = pending.paidAmount ?? 0;

  // Existing active sub for the same live course (excluding this pending row).
  const existingActive = await prisma.liveCourseSubscription.findFirst({
    where: {
      customerId: pending.customerId,
      liveCourseId: pending.liveCourseId,
      status: true,
      paymentStatus: "verified",
      id: { not: pending.id },
      OR: [{ endAt: null }, { endAt: { gte: now } }],
    },
    orderBy: { endAt: "desc" },
  });

  if (existingActive) {
    const newEndAt = extendEndAt({ currentEndAt: existingActive.endAt, durationMonths: durationDays, asDays: true, now });
    const result = await prisma.$transaction(async (tx) => {
      const ext = await tx.liveCourseSubscription.update({
        where: { id: existingActive.id },
        data: {
          endAt: newEndAt,
          paidAmount: (existingActive.paidAmount ?? 0) + amount,
          updatedAt: now,
        },
      });
      // Retire this pending row: mark verified, no fresh window (folded into ext). This
      // retired row is the EXTENSION's purchase-history row, so a with-material extension
      // ships a new kit → give it its own shipment AWB (its id, synthetic AWB) so it's
      // trackable, mirroring the fresh-grant path.
      await tx.liveCourseSubscription.update({
        where: { id: pending.id },
        data: {
          paymentStatus: "verified", razorpayPaymentId, paidAt: now, status: false, updatedAt: now,
          ...(pending.withMaterial ? { trackingId: pending.id, trackingStatus: "pending" } : {}),
        },
      });
      return ext;
    });
    await creditReferrer({ referrerId: pending.referrerId, buyerId: pending.customerId, orderId: pending.id, paidAmount: amount, source: "liveCourse" });
    await debitWallet({ customerId: pending.customerId, orderId: pending.id, coin: pending.walletCoin, source: "liveCourse" });
    return toVerifyDto(result);
  }

  // Fresh grant on this row.
  const startAt = now;
  const endAt = computeEndAt({ startAt, durationMonths: durationDays, asDays: true });
  const updated = await prisma.liveCourseSubscription.update({
    where: { id: pending.id },
    data: {
      paymentStatus: "verified", razorpayPaymentId, paidAt: now, startAt, endAt, status: true, updatedAt: now,
      // Auto-allocate a shipment AWB for with-material orders (mirrors the SQL
      // book/package verify path). The sub id is the synthetic AWB (below the
      // Tirupati threshold → generic trackingUrl); status starts "pending".
      ...(pending.withMaterial ? { trackingId: pending.id, trackingStatus: "pending" } : {}),
    },
  });
  await creditReferrer({ referrerId: pending.referrerId, buyerId: pending.customerId, orderId: pending.id, paidAmount: amount, source: "liveCourse" });
  await debitWallet({ customerId: pending.customerId, orderId: pending.id, coin: pending.walletCoin, source: "liveCourse" });
  return toVerifyDto(updated);
};

/**
 * Webhook fulfillment (paymentWebhook). The webhook arrives independently of the
 * client /verify call; same fold-or-fresh logic, keyed by razorpayOrderId only.
 * Idempotent + safe to run before or after /verify. Returns null if no SQL sub
 * owns this order id (→ caller falls through to Mongo).
 */
export const fulfillLiveCourseWebhookMysql = async (
  razorpayOrderId: string,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto | null> => {
  const pending = await prisma.liveCourseSubscription.findFirst({ where: { razorpayOrderId } });
  if (!pending) return null;
  return verifyLiveCourseOrderMysql(pending, razorpayPaymentId, now);
};
