import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the commerce · order WRITE branch (Phase 3b, COURSE
 * path). Tables: `ws_package_course_order` (the order-of-record),
 * `ws_package_course_subscription` (the entitlement), and
 * `ws_package_course_subscription_tracking` (status trail).
 *
 * Reads here serve the verify owner-lookup + the upsert-extend active-sub query.
 * Writes are exposed as a single transactional fulfillment (`verifyCourseTx`) so
 * a mid-write crash can't leave a complete order with no entitlement.
 *
 * `customer_id` TYPE SPLIT: the order table is VARCHAR, the subscription table is
 * INT (see types.ts). Callers pass the int customer id; we cast to string for the
 * order-row queries/writes.
 */
export const commerceOrderRepository = {
  // ── reads (owner lookup + upsert-extend) ──────────────────────────────────

  /**
   * The course order owning this Razorpay order id, scoped to the customer.
   * Mirrors the Mongo `PackageCourseSubscription.findOne({razorpayOrderId,
   * customerId})` owner lookup — but in SQL the razorpay id lives on the ORDER
   * row. Only course orders qualify: a course order's matching subscription (once
   * created) has a non-null course_id; at order time we tell course-vs-ebook
   * apart by the plan, but for the lookup we simply return the order row and let
   * the service confirm the plan is a course plan.
   */
  findOrderByRazorpay: (razorpayOrderId: string, customerIdStr: string) =>
    prisma.packageCourseOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: Number(customerIdStr) },
    }),

  /** A plan row (PackageCourseEbookPrice) — to read its course_id + duration. */
  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({
      where: { id: planId },
      select: { id: true, courseId: true, packageId: true, duration: true, price: true },
    }),

  /**
   * The customer's existing ACTIVE verified course subscription for the same
   * course (for upsert-extend). Mirrors the Mongo target filter:
   *   {_id≠self, customerId, status:true, paymentStatus:"verified", courseId}
   * In SQL `status=true` IS the verified-entitlement gate (no payment_status
   * column on the subscription table — that lives on the order row).
   */
  findActiveCourseSub: (
    customerId: number,
    courseId: number,
    excludeSubId: number | null,
    now: Date
  ) =>
    prisma.packageCourseSubscription.findFirst({
      where: {
        customerId,
        courseId,
        status: true,
        ...(excludeSubId ? { id: { not: excludeSubId } } : {}),
        OR: [{ endAt: null }, { endAt: { gte: now } }],
      },
      orderBy: { endAt: "desc" },
    }),

  /** The subscription created for a given order (idempotency re-entry). */
  findSubByOrder: (orderId: number) =>
    prisma.packageCourseSubscription.findFirst({ where: { orderId } }),

  // ── write: create the pending order row (create-order endpoint) ────────────

  /**
   * Create a pending course order. customerId is an int; cast to string for the
   * VARCHAR order column. `OrigianalPrice` (SQL `price`) and `amount` (SQL
   * `discount_price`) both = the plan price (no promocode applied here).
   */
  createPendingOrder: (input: {
    customerId: number;
    planId: number;
    price: number;
    razorpayOrderId: string;
  }) =>
    prisma.packageCourseOrder.create({
      data: {
        userId: input.customerId,
        planId: input.planId,
        orderType: "purchase",
        paymentMethod: "razorpay",
        OrigianalPrice: Math.round(input.price),
        amount: Math.round(input.price),
        gatewayOrderId: input.razorpayOrderId,
        status: "pending",
      },
    }),

  // ── write: verify fulfillment (ONE transaction) ───────────────────────────

  /**
   * Transactional course fulfillment. Within one $transaction:
   *  1. flip the order row → complete + razorpay_payment_id
   *  2. EITHER extend an existing active sub (fold window + amount, no new row)
   *     OR create a fresh subscription + its tracking row
   * The tracking row's `order` column = order.id (NOT subscription.id).
   *
   * `now`, `endAt`, and (for extend) the existing sub's new endAt are computed by
   * the service (DAYS planDuration) and passed in — the repo stays IO-only.
   */
  verifyCourseTx: (input: {
    orderId: number;
    razorpayPaymentId: string;
    customerId: number;
    courseId: number;
    planId: number | null;
    amount: number;
    now: Date;
    // fresh-grant case
    fresh?: { startAt: Date; endAt: Date };
    // extend case
    extend?: { existingSubId: number; newEndAt: Date; newAmount: number };
  }) =>
    prisma.$transaction(async (tx) => {
      const order = await tx.packageCourseOrder.update({
        where: { id: input.orderId },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId },
      });

      if (input.extend) {
        const sub = await tx.packageCourseSubscription.update({
          where: { id: input.extend.existingSubId },
          data: { endAt: input.extend.newEndAt, amount: new Prisma.Decimal(input.extend.newAmount) },
        });
        return { order, subscription: sub, extended: true as const };
      }

      // fresh grant: tracking row first (its id is the subscription.tracking FK),
      // then the subscription pointing at both order + tracking.
      const tracking = await tx.packageCourseSubscriptionTracking.create({
        data: { orderId: input.orderId, status: "complete" },
      });
      const sub = await tx.packageCourseSubscription.create({
        data: {
          customerId: input.customerId,
          orderId: input.orderId,
          courseId: input.courseId,
          planId: input.planId,
          trackingId: tracking.id,
          startAt: input.fresh!.startAt,
          endAt: input.fresh!.endAt,
          amount: new Prisma.Decimal(input.amount),
          status: true,
          payment_type: "online",
        },
      });
      return { order, subscription: sub, extended: false as const };
    }),
};
