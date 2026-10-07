// Ebook orders: Prisma queries for orders, plans and subscriptions.
import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import type {
  PromocodeSnapshot,
  ReferralSnapshot,
} from "../order-code-snapshot/order-code-snapshot.types";

/**
 * `ws_ebook_order` (order of record) + `ws_ebook_subscription` (entitlement).
 * `customer_id` is VARCHAR on the order table and INT on the subscription table;
 * the order column holds the numeric customer id.
 */
export const ebookOrderRepository = {
  findOrderByRazorpay: (razorpayOrderId: string, customerIdStr: string) =>
    prisma.eBookOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: Number(customerIdStr) },
    }),

  /** Webhook context: the payload carries no customer. */
  findOrderByRazorpayOnly: (razorpayOrderId: string) =>
    prisma.eBookOrder.findFirst({ where: { gatewayOrderId: razorpayOrderId } }),

  findPlan: (planId: number) =>
    prisma.packageCourseEbookPrice.findUnique({
      where: { id: planId },
      select: { id: true, ebookId: true, duration: true, price: true, status: true },
    }),

  findActiveEbookSub: (customerId: number, ebookId: number, now: Date) =>
    prisma.eBookSubscription.findFirst({
      where: { customerId, ebookId, status: true, endAt: { gt: now } },
      orderBy: { endAt: "desc" },
    }),

  /** Idempotency re-entry. */
  findSubByOrder: (orderId: number) =>
    prisma.eBookSubscription.findFirst({ where: { orderId } }),

  /**
   * `promocode` (json) stores the purchase-time snapshot from
   * `modules/order-code-snapshot`, the same shape `ws_package_course_order` uses.
   * It is required, not cosmetic: `modules/promoter-data` attributes ebook
   * commission via `$.promoterId` and
   * `$.promotedPackageCourseEbook[0].promoterPercentage`.
   *
   * This table has no `refferalcode` column, so a referral snapshot goes in the
   * same column; `referrer_id` discriminates (only one code per order), and a
   * referral snapshot has no `promoterId`, so it never counts as promoter revenue.
   *
   * `order_price` is the charged amount; there is no list-price/discount split
   * on this table.
   */
  createPendingOrder: (input: {
    customerId: number;
    planId: number;
    orderPrice: number;
    razorpayOrderId: string;
    uniqueId: string;
    code?: PromocodeSnapshot | ReferralSnapshot | null;
    referrerId?: number | null;
    coin?: number | null;
  }) =>
    prisma.eBookOrder.create({
      data: {
        userId: input.customerId,
        uniqueId: input.uniqueId,
        planId: input.planId,
        orderType: "purchase",
        paymentMethod: "razorpay",
        orderPrice: Math.round(input.orderPrice),
        promocode: input.code ?? Prisma.DbNull,
        gatewayOrderId: input.razorpayOrderId,
        referrerId: input.referrerId ?? null,
        walletCoin: input.coin ?? null,
        status: "pending",
        // No DB default on these columns; stamp explicitly so they are never NULL.
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  /**
   * One order = one subscription row: a renewal writes its own row starting where
   * the previous one ends, so `price` and `order_id` stay those of the order that
   * bought it. The window is computed by the service.
   */
  verifyEbookTx: (input: {
    orderId: number;
    razorpayPaymentId: string;
    customerId: number;
    ebookId: number;
    price: number;
    now: Date;
    startAt: Date;
    endAt: Date;
    extended: boolean;
  }) =>
    prisma.$transaction(async (tx) => {
      // Claim: only a still-pending row flips. The loser of a concurrent /verify +
      // webhook matches 0 rows, writes nothing and returns null.
      const claim = await tx.eBookOrder.updateMany({
        where: { id: input.orderId, status: "pending" },
        data: { status: "complete", gatewayPaymentId: input.razorpayPaymentId, updatedAt: input.now },
      });
      if (claim.count === 0) return null;
      const order = await tx.eBookOrder.findUniqueOrThrow({ where: { id: input.orderId } });

      const sub = await tx.eBookSubscription.create({
        data: {
          orderId: input.orderId,
          customerId: input.customerId,
          ebookId: input.ebookId,
          price: new Prisma.Decimal(input.price),
          startAt: input.startAt,
          endAt: input.endAt,
          payment_type: "online",
          status: true,
          createdAt: input.now,
          updatedAt: input.now,
        },
      });
      return { order, subscription: sub, extended: input.extended };
    }),
};
