// Book orders: cart preview, checkout, payment verify, webhook fulfilment and tracking.
import { prisma } from "../../config/prisma";
import { bookOrderRepository as repo } from "./book-order.repository";
import {
  toBookOrderRow,
  toBookOrderDto,
  toMyOrderListDto,
  toMyOrderDetailDto,
} from "./book-order.transformer";
import type {
  BookOrderDto,
  BookOrderRow,
  CreatedBookOrder,
  CreateOrderItemInput,
  MyOrderDto,
} from "./book-order.types";

export const parseBookOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/**
 * Read from ws_book_setting (settingKey='default'), the value the admin edits via
 * PUT /admin/books/settings.
 */
export const getFreeShippingMin = async (): Promise<number> => {
  const row = await prisma.bookSetting.findFirst({
    where: { settingKey: "default" },
    select: { freeShippingMinOrderAmount: true },
  });
  return row?.freeShippingMinOrderAmount ?? 0;
};

export interface BookOrderPreview {
  cartId: string;
  shippingId: number;
  amount: number;
  items: CreateOrderItemInput[];
  breakdown: {
    totalListPrice: number;
    totalDiscountedPrice: number;
    shipping: number;
    shippingWaived: boolean;
  };
}

/**
 * create-order phase 1: validate the cart and compute totals and the priced item
 * snapshot, without writing. The controller creates the Razorpay order from
 * `amount` and then calls `writeBookOrderMysql`, so no write is held open across
 * the external call.
 */
export const previewBookOrderFromCartMysql = async (
  customerId: number
): Promise<
  | { ok: true; preview: BookOrderPreview }
  | { ok: false; code: "EMPTY_CART" | "NO_SHIPPING" | "UNAVAILABLE" | "ZERO_AMOUNT" }
> => {
  const cart = await repo.findActiveCart(customerId);
  const cartItems = cart?.bookCartItem ?? [];
  if (!cart || cartItems.length === 0) return { ok: false, code: "EMPTY_CART" };
  if (cart.shippingId == null) return { ok: false, code: "NO_SHIPPING" };

  const bookIds = cartItems.map((ci) => ci.bookId).filter((b): b is number => b != null);
  const books = await repo.findBooksByIds(bookIds);
  if (books.length !== bookIds.length) return { ok: false, code: "UNAVAILABLE" };

  const byId = new Map(books.map((b) => [b.id, b]));
  const freeShippingMin = await getFreeShippingMin();

  let totalListPrice = 0;
  let totalDiscountedPrice = 0;
  let rawShipping = 0;
  for (const ci of cartItems) {
    const b = ci.bookId != null ? byId.get(ci.bookId) : undefined;
    if (!b) continue;
    const qty = ci.qty ?? 0;
    totalListPrice += (b.list_price ?? 0) * qty;
    totalDiscountedPrice += (b.discounted_price ?? 0) * qty;
    rawShipping += (b.shipping_price ?? 0) * qty;
  }
  const shippingWaived = freeShippingMin > 0 && totalDiscountedPrice >= freeShippingMin;
  const effectiveShipping = shippingWaived ? 0 : rawShipping;
  const amount = totalDiscountedPrice + effectiveShipping;
  if (amount <= 0) return { ok: false, code: "ZERO_AMOUNT" };

  const items: CreateOrderItemInput[] = cartItems
    .filter((ci) => ci.bookId != null && byId.has(ci.bookId))
    .map((ci) => {
      const b = byId.get(ci.bookId!)!;
      return {
        bookId: b.id,
        qty: ci.qty ?? 0,
        listPrice: b.list_price ?? 0,
        price: b.discounted_price ?? 0,
        shippingPrice: shippingWaived ? 0 : (b.shipping_price ?? 0),
      };
    });

  return {
    ok: true,
    preview: {
      cartId: cart.cart_id,
      shippingId: cart.shippingId,
      amount,
      items,
      breakdown: { totalListPrice, totalDiscountedPrice, shipping: effectiveShipping, shippingWaived },
    },
  };
};

export const writeBookOrderMysql = async (input: {
  customerId: number;
  orderKey: string;
  preview: BookOrderPreview;
  razorpayOrderId: string;
  razorpayOrderPayload: string;
  userIp?: string | null;
}): Promise<CreatedBookOrder> => {
  const order = await repo.createPendingOrder({
    orderKey: input.orderKey,
    customerId: input.customerId,
    cartId: input.preview.cartId,
    shippingId: input.preview.shippingId,
    amount: input.preview.amount,
    razorpayOrderId: input.razorpayOrderId,
    razorpayOrderPayload: input.razorpayOrderPayload,
    orderItemsJson: JSON.stringify(input.preview.items),
    items: input.preview.items,
    userIp: input.userIp ?? null,
  });
  return { orderId: order.id, orderKey: input.orderKey };
};

/** `cartId` is the cart's VARCHAR business key. */
export const getActiveCartState = async (
  customerId: number
): Promise<{ cartId: string | null; qtyByBookId: Map<string, number> }> => {
  const cart = await repo.findActiveCartState(customerId);
  const qtyByBookId = new Map<string, number>();
  if (!cart) return { cartId: null, qtyByBookId };
  for (const it of cart.bookCartItem) {
    if (it.bookId != null) qtyByBookId.set(String(it.bookId), it.qty ?? 0);
  }
  return { cartId: cart.cart_id, qtyByBookId };
};

export const getPurchasedBookIdSet = async (
  customerId: number
): Promise<Set<string>> => {
  const ids = await repo.findPurchasedBookIds(customerId);
  return new Set(ids.map(String));
};

export const findBookOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
): Promise<BookOrderRow | null> => {
  const order = await repo.findOrderByRazorpay(razorpayOrderId, customerId);
  return order ? toBookOrderRow(order) : null;
};

/**
 * Idempotent: an already-verified order returns its DTO without re-running side
 * effects (no second AWB, no second cart deactivation).
 */
export const verifyBookOrderMysql = async (
  order: BookOrderRow,
  razorpayPaymentId: string
): Promise<BookOrderDto> => {
  if (order.status !== "pending") {
    const raw = await repo.findOrderByRazorpay(order.razorpayOrderId ?? "", order.customerId);
    const items = await repo.findOrderItems(order.orderKey);
    if (raw) return toBookOrderDto(raw, items);
  }

  const result = await repo.verifyBookTx({
    orderId: order.id,
    orderKey: order.orderKey,
    razorpayPaymentId,
    customerId: order.customerId,
    shippingId: order.shippingId,
  });
  const items = await repo.findOrderItems(order.orderKey);
  if (!result) {
    // A concurrent /verify or webhook fulfilled this order first; return that result.
    const raw = await repo.findOrderByRazorpay(order.razorpayOrderId ?? "", order.customerId);
    if (!raw) throw new Error("book-order: order is not pending and cannot be re-read");
    return toBookOrderDto(raw, items);
  }
  return toBookOrderDto(result.order, items);
};

/** Webhook fulfillment, keyed by razorpayOrderId alone (the payload carries no customer). Null on miss. */
export const fulfillBookWebhookMysql = async (
  razorpayOrderId: string,
  razorpayPaymentId: string
): Promise<BookOrderDto | null> => {
  const order = await repo.findOrderByRazorpayOnly(razorpayOrderId);
  if (!order) return null;
  return verifyBookOrderMysql(toBookOrderRow(order), razorpayPaymentId);
};

// ws_book_order has no shipped_at/delivered_at and ws_book_tracking holds a single
// status row (no courier/location/history), so those fields are null/[].
// Null when the order isn't the customer's.
export const getOrderTrackingMysql = async (orderId: number, customerId: number) => {
  const order = await prisma.bookOrder.findFirst({
    where: { id: orderId, userId: customerId },
    include: { shipping: true, BookTracking: true },
  });
  if (!order) return null;
  const ship: any = order.shipping ?? {};
  const awb = order.trackingId != null ? Number(order.trackingId) : null;
  const trackStatus = order.BookTracking?.status ?? null;
  const trackAt = order.BookTracking?.updatedAt ?? order.BookTracking?.createdAt ?? null;
  return {
    orderId: String(order.id),
    receiptId: order.receiptId,
    awb,
    courier: null, // not stored on SQL (the AWB range drives buildTrackingUrl)
    from: { city: null, hub: null }, // no SQL book-settings origin
    to: { city: ship.city ?? null, hub: ship.address ?? null, pincode: ship.pincode ?? null },
    consignee: ship.name ?? null,
    consigneePhone: ship.phone != null ? String(ship.phone) : null,
    bookedAt: order.paidAt ?? order.createdAt ?? null,
    currentStatus: trackStatus ?? order.status,
    orderStatus: order.status,
    shippedAt: null,
    deliveredAt: null,
    history: trackStatus ? [{ status: trackStatus, location: null, note: null, at: trackAt }] : [],
  };
};

export const listMyOrdersMysql = async (
  customerId: number,
  opts: { status?: string; page: number; limit: number }
): Promise<{ data: MyOrderDto[]; total: number }> => {
  const skip = (opts.page - 1) * opts.limit;
  const [orders, total] = await repo.findMyOrders({
    customerId,
    status: opts.status,
    skip,
    take: opts.limit,
  });
  const items = await repo.findOrderItemsByKeys(orders.map((o) => o.receiptId));
  const byKey = new Map<string, typeof items>();
  for (const it of items) {
    const arr = byKey.get(it.order_id) ?? [];
    arr.push(it);
    byKey.set(it.order_id, arr);
  }
  const data = orders.map((o) => toMyOrderListDto(o, byKey.get(o.receiptId) ?? []));
  return { data, total };
};

export const getMyOrderByIdMysql = async (
  orderId: number,
  customerId: number
): Promise<MyOrderDto | null> => {
  const order = await repo.findMyOrderById(orderId, customerId);
  if (!order) return null;
  const items = await repo.findOrderItemsWithBook(order.receiptId);
  return toMyOrderDetailDto(order, items);
};

// Status and AWB only; null when the order isn't the customer's.
export const getOrderTrackingLiveMysql = async (orderId: number, customerId: number) => {
  const order = await prisma.bookOrder.findFirst({
    where: { id: orderId, userId: customerId },
    select: { status: true, trackingId: true },
  });
  if (!order) return null;
  return { status: order.status, trackingId: order.trackingId != null ? Number(order.trackingId) : null };
};
