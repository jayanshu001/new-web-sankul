import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";
import { computeEndAt } from "../../utils/planDuration";
import { creditReferrer } from "../../client/referral/credit-referrer";
import { debitWallet } from "../../client/referral/debit-wallet";

/**
 * Live-course payment write path on SQL.
 *
 * Since 2026-08-25 live course has a real order table and follows the same rule as
 * every other product: THE ORDER OWNS PAYMENT, THE SUBSCRIPTION OWNS ENTITLEMENT,
 * and ONE ORDER = ONE SUBSCRIPTION ROW. Checkout writes a pending
 * `ws_live_course_order`; verify flips it to complete and CREATES a subscription row
 * for it. A renewal gets its own order and its own subscription row starting where
 * the current entitlement ends — it never folds onto the existing row.
 *
 * Before that, the design was SINGLE-TABLE: `ws_live_course_subscription` carried
 * the payment fields too, checkout wrote a `payment_status='pending'` subscription
 * row, and a renewal had to fold (bump end_at, retire the pending row) because there
 * was no second table to record the second payment. Those payment columns still
 * exist on the subscription for pre-migration rows — new writes do not touch them.
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

/**
 * The verify DTO is unchanged on the wire: entitlement fields come from the
 * subscription, payment fields from the order. `paymentStatus` still reports the
 * subscription vocabulary ("verified"), NOT the order's "complete" — the field is
 * part of a shipped response shape and is mapped, not renamed.
 *
 * `sub` is null only on the defensive path where an order is complete but its
 * subscription is missing; the DTO then carries the order's own identity so the
 * caller still gets a well-formed response.
 */
const ORDER_STATUS_TO_PAYMENT_STATUS: Record<string, string> = {
  pending: "pending",
  complete: "verified",
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
  paidAmount: order.paidAmount ?? null,
  paymentStatus: ORDER_STATUS_TO_PAYMENT_STATUS[order.status] ?? order.status ?? null,
  razorpayOrderId: order.razorpayOrderId ?? null,
  razorpayPaymentId: order.razorpayPaymentId ?? null,
  createdAt: sub?.createdAt ?? order.createdAt ?? null,
  updatedAt: sub?.updatedAt ?? order.updatedAt ?? null,
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

/** Minimal live-course lookup (id + name + status) for SQL order responses.
 *  `status` lets create-order refuse a deactivated live course. */
export const findLiveCourse = (id: number) =>
  prisma.liveCourse.findFirst({ where: { id }, select: { id: true, name: true, status: true } });

/** All active pricing plans for a live course (apply-promo plan list). */
export const listPlansForLiveCourse = (liveCourseId: number) =>
  prisma.liveCoursePlan.findMany({
    where: { liveCourseId, status: true },
    orderBy: [{ isDefault: "desc" }, { price: "asc" }, { id: "asc" }],
  });

/**
 * The promo discount on a live-course subscription, DERIVED.
 *
 * `ws_live_course_subscription.discount_amount` was dropped 2026-08-20 as redundant.
 * This function is the exact inverse of what `createLiveCourseOrderMysql` writes:
 *
 *   paid_amount = original_amount - discount - wallet_coin
 *
 * `original_amount` is set ONLY when a promo was applied (the same condition under
 * which `discount_amount` used to be non-NULL), so a NULL original means no promo and
 * therefore no discount. Wallet coin is subtracted out because it is redemption, not
 * a discount — it was never part of the stored value either.
 *
 * Both API readers (live-course receipt, admin customer-details DTO) call this, so
 * their responses are byte-identical to when the column existed. Keep the two in
 * sync: if the write formula ever changes, this must change with it.
 */
export const liveSubDiscountAmount = (sub: {
  originalAmount?: number | null;
  paidAmount?: number | null;
  walletCoin?: number | null;
}): number => {
  if (sub.originalAmount == null) return 0;
  const discount = Number(sub.originalAmount) - Number(sub.paidAmount ?? 0) - Number(sub.walletCoin ?? 0);
  // Clamp: a hand-edited or partially-refunded row must not report a negative discount.
  return discount > 0 ? discount : 0;
};

/**
 * Create the pending live-course ORDER row + return its id. Nothing is granted yet:
 * no subscription row exists until the payment verifies, which is exactly why an
 * abandoned checkout can no longer leave an unverified row in the entitlement table.
 */
export const createLiveCourseOrderMysql = async (input: {
  customerId: number;
  liveCourseId: number;
  planId: number;
  amount: number;
  razorpayOrderId: string;
  /**
   * Purchase-time code snapshots from `buildOrderCodeSnapshots({..., planKind:
   * "livePlan"})`. Frozen objects, routed to exactly ONE column — a real promocode →
   * `promocode`, a customer referral code → `refferalcode` — mirroring
   * ws_package_course_order. Both null when no code was applied, or when the snapshot
   * could not be built — a snapshot never blocks a payment.
   *
   * These REPLACE the old `promocode_id` / `referrer_id` columns (dropped 2026-08-20):
   * the snapshot is now the single source of truth for who redeemed what, and the
   * referral credit at verify reads the referrer out of it (referrerIdOf below).
   */
  promocodeSnapshot?: unknown | null;
  refferalcodeSnapshot?: unknown | null;
  coin?: number | null;
  /**
   * Pre-promo plan price, set ONLY when a promo was applied. This is what makes the
   * discount derivable (see liveSubDiscountAmount) now that `discount_amount` is
   * gone — do NOT stop writing it.
   */
  originalAmount?: number | null;
  withMaterial?: boolean;
  customerShippingId?: number | null;
  now: Date;
}): Promise<{ orderId: number }> => {
  const order = await prisma.liveCourseOrder.create({
    data: {
      customerId: input.customerId,
      liveCourseId: input.liveCourseId,
      planId: input.planId,
      paidAmount: Math.round(input.amount),
      originalAmount: input.originalAmount != null ? Math.round(input.originalAmount) : null,
      // `?? Prisma.DbNull` (not `?? null`): on a Json column Prisma reads a bare
      // `null` as JsonNull — the JSON literal `null` INSIDE the column — whereas
      // DbNull is a real SQL NULL. The report treats SQL NULL as "no code"; a JSON
      // null would be a non-empty value that every JSON_EXTRACT path then misses.
      promocode: (input.promocodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
      refferalcode: (input.refferalcodeSnapshot as Prisma.InputJsonValue) ?? Prisma.DbNull,
      walletCoin: input.coin ?? null,
      paymentMethod: "online",
      status: "pending",
      withMaterial: !!input.withMaterial,
      customerShippingId: input.customerShippingId ?? null,
      razorpayOrderId: input.razorpayOrderId,
      createdAt: input.now,
      updatedAt: input.now,
    },
  });
  return { orderId: order.id };
};

/**
 * The referring CUSTOMER's id, read out of the subscription's frozen referral
 * snapshot. Replaces the dropped `referrer_id` column as the input to the
 * post-payment referral credit.
 *
 * ⚠ In the legacy referral shape the key `promoter` holds the referring CUSTOMER
 * (not a ws_promoter), so the id lives at `$.refferalcode.promoter.id` — the same
 * value `referrer_id` used to carry. A promocode snapshot has no referrer at all and
 * correctly yields null, so promocode purchases never credit anyone.
 *
 * Returns null for pre-2026-08-20 rows that were never backfilled; creditReferrer
 * treats a null referrer as "nothing to credit" and is a no-op.
 */
const referrerIdOf = (row: { refferalcode: unknown }): number | null => {
  const ref = row.refferalcode as any;
  const id = ref && typeof ref === "object" ? ref.promoter?.id : null;
  return Number.isInteger(id) && id > 0 ? (id as number) : null;
};

/** Owner lookup for verify (the order owning this razorpay order id). */
export const findLiveCourseOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
) => prisma.liveCourseOrder.findFirst({ where: { razorpayOrderId, customerId } });

/**
 * Verify fulfillment. Idempotent: an order that is no longer "pending" returns its
 * existing subscription untouched.
 *
 * Otherwise, in ONE transaction: the order flips to "complete" and a NEW
 * subscription row is created for it. A renewal continues from the customer's
 * current entitlement (`startAt = existing.endAt` when that is still in the future,
 * else now) and leaves that row alone — the pre-2026-08-25 behaviour folded the
 * window onto it and retired the pending row instead, which is why a renewal's
 * payment had nowhere of its own to live.
 *
 * `duration` is DAYS — see [[project_plan_duration_unit]].
 */
export const verifyLiveCourseOrderMysql = async (
  order: any,
  razorpayPaymentId: string,
  now: Date = new Date()
): Promise<LiveCourseVerifyDto> => {
  // Idempotency: the order already ran. Return the subscription it produced.
  if (order.status && order.status !== "pending") {
    const existingSub = await prisma.liveCourseSubscription.findFirst({ where: { orderId: order.id } });
    return toVerifyDto(existingSub, order);
  }

  const plan = await prisma.liveCoursePlan.findFirst({
    where: { id: order.planId ?? 0 },
    select: { duration: true },
  });
  const durationDays = plan?.duration ?? 0;
  const amount = order.paidAmount ?? 0;

  // The customer's current entitlement for this live course, read ONLY to place the
  // new window. `endAt: null` is a lifetime grant, which cannot be continued from —
  // it never ends — so such a row falls through to `now` like a lapsed one.
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
    await tx.liveCourseOrder.update({
      where: { id: order.id },
      data: { status: "complete", razorpayPaymentId, paidAt: now, updatedAt: now },
    });

    const created = await tx.liveCourseSubscription.create({
      data: {
        orderId: order.id,
        customerId: order.customerId,
        liveCourseId: order.liveCourseId,
        planId: order.planId ?? null,
        startAt,
        endAt,
        status: true,
        // Material choice is made at checkout and rides along on the order; the
        // entitlement row copies it so dispatch + access checks stay row-local.
        withMaterial: !!order.withMaterial,
        customerShippingId: order.customerShippingId ?? null,
        createdAt: now,
        updatedAt: now,
      },
    });

    // Auto-allocate a shipment AWB for with-material purchases (mirrors the SQL
    // book/package verify path). The SUBSCRIPTION id is the synthetic AWB — the same
    // id space historical live AWBs used, so nothing collides with a legacy row.
    // It can only be set after the insert, hence the second write.
    if (order.withMaterial) {
      return tx.liveCourseSubscription.update({
        where: { id: created.id },
        data: { trackingId: created.id, trackingStatus: "pending" },
      });
    }
    return created;
  });

  // Referral credit + wallet debit are keyed to the ORDER id (the payment record).
  // Both are idempotent and non-throwing — neither may block fulfilment.
  await creditReferrer({ referrerId: referrerIdOf(order), buyerId: order.customerId, orderId: order.id, paidAmount: amount, source: "liveCourse" });
  await debitWallet({ customerId: order.customerId, orderId: order.id, coin: order.walletCoin, source: "liveCourse" });
  return toVerifyDto(sub, { ...order, status: "complete", razorpayPaymentId, paidAt: now });
};

/**
 * Webhook fulfillment (paymentWebhook). The webhook arrives independently of the
 * client /verify call; same fulfilment, keyed by razorpayOrderId ALONE (the razorpay
 * payload carries no customer). Idempotent + safe to run before or after /verify.
 * Returns null if no SQL order owns this id (→ caller falls through).
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
