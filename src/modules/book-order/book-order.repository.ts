import { prisma } from "../../config/prisma";
import { Prisma } from "@prisma/client";
import type { CreateOrderItemInput } from "./book-order.types";

/**
 * Prisma persistence for the book · order WRITE branch (Phase 3b, 5 tables). See
 * book-order.types.ts + docs/migration/BOOK_ORDER_SCOPE.md.
 *
 * order_id is the VARCHAR business key (child tables + tracking FK on it); the
 * int `id` is the PK. customer_id is INT (no VARCHAR split). The AWB is allocated
 * by inserting a ws_book_tracking row (bigint AUTO_INCREMENT).
 */
export const bookOrderRepository = {
  // ── cart reads (create-order) ──────────────────────────────────────────────

  /** The customer's active cart with its item rows + book prices. */
  findActiveCart: (customerId: number) =>
    prisma.bookCart.findFirst({
      where: { userId: customerId, active: true },
      include: { bookCartItem: { include: { book: true } } },
      orderBy: { id: "desc" },
    }),

  /** Active books by id (availability + pricing for the order snapshot). */
  findBooksByIds: (ids: number[]) =>
    prisma.book.findMany({ where: { id: { in: ids }, active: true } }),

  // ── owner lookup (verify) ──────────────────────────────────────────────────

  findOrderByRazorpay: (razorpayOrderId: string, customerId: number) =>
    prisma.bookOrder.findFirst({
      where: { gatewayOrderId: razorpayOrderId, userId: customerId },
    }),

  /** Line items for an order (by VARCHAR business key) — for the DTO. */
  findOrderItems: (orderKey: string) =>
    prisma.bookOrderItem.findMany({ where: { order_id: orderKey } }),

  // ── cart/purchase state reads (catalog-book composition) ───────────────────

  /**
   * The customer's active cart (id + item rows) — for the listing's `cartId` +
   * per-book `qty`. Mirrors `BookCart.findOne({customerId, status:true})`.
   */
  findActiveCartState: (customerId: number) =>
    prisma.bookCart.findFirst({
      where: { userId: customerId, active: true },
      include: { bookCartItem: { select: { bookId: true, qty: true } } },
      orderBy: { id: "desc" },
    }),

  /**
   * Distinct book ids the customer has PURCHASED — any order in a fulfilled
   * status (verified/shipped/delivered), joined to its item rows. Mirrors
   * `BookOrder.distinct("items.bookId", {customerId, status:{$in:[...]}})`.
   */
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

  // ── write: create the pending order + its item rows (ONE txn) ──────────────

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
  }) =>
    prisma.$transaction(async (tx) => {
      const order = await tx.bookOrder.create({
        data: {
          receiptId: input.orderKey, // @map("order_id") — the VARCHAR key
          userId: input.customerId,
          cartId: input.cartId,
          shippingId: input.shippingId,
          orderType: "purchase",
          orderItems: input.orderItemsJson,
          paymentMethod: "razorpay",
          amount: new Prisma.Decimal(input.amount),
          gatewayOrderId: input.razorpayOrderId,
          gatewayOrder: input.razorpayOrderPayload,
          status: "pending",
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

  // ── write: verify fulfillment (ONE txn) ────────────────────────────────────

  /**
   * Transactional book fulfillment. Within one $transaction:
   *  1. insert a ws_book_tracking row → bigint AUTO_INCREMENT hands out the AWB
   *  2. flip the order → verified + tracking_id + gateway_transaction_id
   *  3. deactivate the matching active cart(s) (status=0; cart_item rows kept)
   */
  verifyBookTx: (input: {
    orderId: number;
    orderKey: string;
    razorpayPaymentId: string;
    customerId: number;
    shippingId: number | null;
  }) =>
    prisma.$transaction(async (tx) => {
      // NOTE: ws_book_tracking.status is varchar(10) — "Order Placed" (12) would
      // overflow. Store the short code "verified" (matches existing rows' short
      // statuses like "pending"/"completed"); the DTO synthesizes the human
      // "Order Placed" display text + history (signed-off D-B3).
      const tracking = await tx.bookTracking.create({
        data: { orderId: input.orderKey, status: "verified" },
      });
      const order = await tx.bookOrder.update({
        where: { id: input.orderId },
        data: {
          status: "verified",
          trackingId: tracking.tracking_id,
          gatewayPaymentId: input.razorpayPaymentId,
        },
      });
      // Deactivate the active cart that placed this order (match shipping, like
      // the Mongo path). cart_item rows are left intact (signed-off D-B2).
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
