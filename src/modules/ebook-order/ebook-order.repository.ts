import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the ebook · order WRITE branch (Phase 3b). Tables:
 * `ws_ebook_order` (order-of-record) + `ws_ebook_subscription` (entitlement).
 * NO tracking table (unlike course). Mirrors commerce-order.repository.
 *
 * `customer_id` TYPE SPLIT: order table VARCHAR, subscription table INT. Callers
 * pass the int customer id; we cast to number for the order-row queries (the
 * VARCHAR column holds the numeric customer id, confirmed in staging).
 */
export const ebookOrderRepository = {
  // ── reads ──────────────────────────────────────────────────────────────────

  /** The ebook order owning this Razorpay id, scoped to the customer. */
  findOrderByRazorpay: (razorpayOrderId: string, customerIdStr: string) =>
    prisma.eBookOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: Number(customerIdStr) },
    }),

  /** A plan row — to read its ebook_id + duration + price. */
  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({
      where: { id: planId },
      select: { id: true, ebookId: true, duration: true, price: true },
    }),

  /**
   * The customer's existing ACTIVE, unexpired ebook subscription (for
   * upsert-extend). Mirrors the Mongo filter
   *   {customerId, ebookId, status:true, endAt:{$gt:now}}.
   */
  findActiveEbookSub: (customerId: number, ebookId: number, now: Date) =>
    prisma.eBookSubscription.findFirst({
      where: { customerId, ebookId, status: true, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  /** The subscription created for a given order (idempotency re-entry). */
  findSubByOrder: (orderId: number) =>
    prisma.eBookSubscription.findFirst({ where: { orderId } }),

  // ── write: create the pending order row (create-order endpoint) ────────────

  createPendingOrder: (input: {
    customerId: number;
    planId: number;
    orderPrice: number;
    razorpayOrderId: string;
    uniqueId: string;
  }) =>
    prisma.eBookOrder.create({
      data: {
        userId: input.customerId,
        uniqueId: input.uniqueId,
        planId: input.planId,
        orderType: "purchase",
        paymentMethod: "razorpay",
        orderPrice: Math.round(input.orderPrice),
        gatewayOrderId: input.razorpayOrderId,
        status: "pending",
      },
    }),

  // ── write: verify fulfillment (ONE transaction) ───────────────────────────

  /**
   * Transactional ebook fulfillment. Within one $transaction:
   *  1. flip the order → complete + razorpay_payment_id
   *  2. EITHER extend the active subscription (fold endAt + sum price, point at
   *     the latest order) OR create a fresh subscription.
   * `now`/`endAt`/`newEndAt` are computed by the service (DAYS planDuration).
   */
  verifyEbookTx: (input: {
    orderId: number;
    razorpayPaymentId: string;
    customerId: number;
    ebookId: number;
    price: number;
    now: Date;
    fresh?: { startAt: Date; endAt: Date };
    extend?: { existingSubId: number; newEndAt: Date; newPrice: number };
  }) =>
    prisma.$transaction(async (tx) => {
      const order = await tx.eBookOrder.update({
        where: { id: input.orderId },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId },
      });

      if (input.extend) {
        const sub = await tx.eBookSubscription.update({
          where: { id: input.extend.existingSubId },
          data: {
            endAt: input.extend.newEndAt,
            price: new Prisma.Decimal(input.extend.newPrice),
            orderId: input.orderId, // follow the latest paid order
          },
        });
        return { order, subscription: sub, extended: true as const };
      }

      const sub = await tx.eBookSubscription.create({
        data: {
          orderId: input.orderId,
          customerId: input.customerId,
          ebookId: input.ebookId,
          price: new Prisma.Decimal(input.price),
          startAt: input.fresh!.startAt,
          endAt: input.fresh!.endAt,
          payment_type: "online",
          status: true,
        },
      });
      return { order, subscription: sub, extended: false as const };
    }),
};
