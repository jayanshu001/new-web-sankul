// Book orders: Prisma queries.
import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import type { CreateOrderItemInput } from "./book-order.types";

export const bookOrderRepository = {
  findActiveCart: (customerId: number) =>
    prisma.bookCart.findFirst({
      where: { userId: customerId, active: true },
      include: { bookCartItem: { include: { book: true } } },
      orderBy: { id: "desc" },
    }),

  findBooksByIds: (ids: number[]) =>
    prisma.book.findMany({ where: { id: { in: ids }, active: true } }),

  findOrderByRazorpay: (razorpayOrderId: string, customerId: number) =>
    prisma.bookOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: customerId },
    }),

  /** Webhook context: the payload carries no customer. */
  findOrderByRazorpayOnly: (razorpayOrderId: string) =>
    prisma.bookOrder.findFirst({ where: { gatewayOrderId: razorpayOrderId } }),

  findOrderItems: (orderKey: string) =>
    prisma.bookOrderItem.findMany({ where: { order_id: orderKey } }),

  findMyOrders: (input: {
    customerId: number;
    status?: string;
    skip: number;
    take: number;
  }) => {
    const where = {
      userId: input.customerId,
      ...(input.status ? { status: input.status } : {}),
    };
    return prisma.$transaction([
      prisma.bookOrder.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: input.skip,
        take: input.take,
      }),
      prisma.bookOrder.count({ where }),
    ]);
  },

  findOrderItemsByKeys: (orderKeys: string[]) =>
    prisma.bookOrderItem.findMany({ where: { order_id: { in: orderKeys } } }),

  findMyOrderById: (orderId: number, customerId: number) =>
    prisma.bookOrder.findFirst({
      where: { id: orderId, userId: customerId },
      include: { shipping: true },
    }),

  findOrderItemsWithBook: (orderKey: string) =>
    prisma.bookOrderItem.findMany({
      where: { order_id: orderKey },
      include: { Book: true },
    }),

  findActiveCartState: (customerId: number) =>
    prisma.bookCart.findFirst({
      where: { userId: customerId, active: true },
      include: { bookCartItem: { select: { bookId: true, qty: true } } },
      orderBy: { id: "desc" },
    }),

  /** Distinct book ids from the customer's orders in a fulfilled status (verified/shipped/delivered). */
  findPurchasedBookIds: async (customerId: number): Promise<number[]> => {
    const orders = await prisma.bookOrder.findMany({
      where: { userId: customerId, status: { in: ["verified", "shipped", "delivered"] } },
      select: { receiptId: true },
    });
    if (!orders.length) return [];
    const items = await prisma.bookOrderItem.findMany({
      where: { order_id: { in: orders.map((o) => o.receiptId) } },
      select: { bookId: true },
    });
    return [...new Set(items.map((i) => i.bookId).filter((b): b is number => b != null))];
  },

  createPendingOrder: (input: {
    orderKey: string;
    customerId: number;
    cartId: string;
    shippingId: number;
    amount: number;
    razorpayOrderId: string;
    razorpayOrderPayload: string;
    orderItemsJson: string;
    items: CreateOrderItemInput[];
    userIp?: string | null;
  }) =>
    prisma.$transaction(async (tx) => {
      // ws_book_order has no DB default on created_at/updated_at, so stamp both.
      const now = new Date();
      const order = await tx.bookOrder.create({
        data: {
          receiptId: input.orderKey, // @map("order_id") — the VARCHAR key
          userId: input.customerId,
          userIp: input.userIp ?? null,
          cartId: input.cartId,
          shippingId: input.shippingId,
          orderType: "purchase",
          orderItems: input.orderItemsJson,
          paymentMethod: "razorpay",
          amount: new Prisma.Decimal(input.amount),
          gatewayOrderId: input.razorpayOrderId,
          gatewayOrder: input.razorpayOrderPayload,
          status: "pending",
          createdAt: now,
          updatedAt: now,
        },
      });
      if (input.items.length) {
        await tx.bookOrderItem.createMany({
          data: input.items.map((it) => ({
            order_id: input.orderKey,
            bookId: it.bookId,
            qty: it.qty,
            list_price: Math.round(it.listPrice),
            price: Math.round(it.price),
            shipping_price: Math.round(it.shippingPrice),
          })),
        });
      }
      return order;
    }),

  /**
   * In one transaction: claim the order (pending → verified), insert a
   * ws_book_tracking row to allocate the AWB, stamp tracking_id on the order, and
   * deactivate the matching cart. Returns null when the order was no longer
   * pending; nothing is written and no second AWB is allocated.
   */
  verifyBookTx: (input: {
    orderId: number;
    orderKey: string;
    razorpayPaymentId: string;
    customerId: number;
    shippingId: number | null;
  }) =>
    prisma.$transaction(async (tx) => {
      // Claim first: only a still-pending order flips. The loser of a concurrent
      // /verify + webhook matches 0 rows and stops before the AWB insert (a
      // rolled-back insert would still burn an AUTO_INCREMENT value), so the parcel
      // ships once.
      const claim = await tx.bookOrder.updateMany({
        where: { id: input.orderId, status: "pending" },
        data: {
          status: "verified",
          // Razorpay payment id → gateway_transaction_id.
          gatewayPaymentId: input.razorpayPaymentId,
          paidAt: new Date(),
          updatedAt: new Date(),
        },
      });
      if (claim.count === 0) return null;
      // ws_book_tracking.status is varchar(10), too short for "Order Placed"; store
      // the short code and let the DTO synthesize the display text and history.
      const tracking = await tx.bookTracking.create({
        data: { orderId: input.orderKey, status: "verified" },
      });
      const order = await tx.bookOrder.update({
        where: { id: input.orderId },
        data: { trackingId: tracking.tracking_id },
      });
      // Deactivate the cart that placed this order (matched by shipping); cart_item rows are kept.
      const carts = await tx.bookCart.updateMany({
        where: {
          userId: input.customerId,
          active: true,
          ...(input.shippingId != null ? { shippingId: input.shippingId } : {}),
        },
        data: { active: false },
      });
      return { order, tracking, cartsDeactivated: carts.count };
    }),
};
