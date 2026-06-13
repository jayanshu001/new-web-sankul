/**
 * Book · Order (WRITE — Phase 3b) service — dual-path (MySQL ↔ Mongo).
 *
 * Module key: `book-order`. Cart-checkout write path (5 tables). See
 * book-order.types.ts + docs/migration/BOOK_ORDER_SCOPE.md.
 *
 * Exposes:
 *  - isBookOrderMysql() / parseBookOrderId()
 *  - buildBookOrderFromCartMysql()  — read cart, validate, compute totals, write
 *                                     the pending order + item rows (create-order)
 *  - findBookOrderForVerify()       — DUAL-READ owner lookup (rollback net)
 *  - verifyBookOrderMysql()         — txn: tracking AWB + order→verified + cart off
 *
 * Flag OFF until go-live sign-off.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";
import { bookOrderRepository as repo } from "./book-order.repository";
import { toBookOrderRow, toBookOrderDto } from "./book-order.transformer";
import type {
  BookOrderDto,
  BookOrderRow,
  CreatedBookOrder,
  CreateOrderItemInput,
} from "./book-order.types";

export const BOOK_ORDER_MODULE = "book-order";

export const isBookOrderMysql = (): boolean => isMysqlModule(BOOK_ORDER_MODULE);

export const parseBookOrderId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The book free-shipping threshold (ws_termsandcondition, module='book'). */
const getFreeShippingMin = async (): Promise<number> => {
  const row = await prisma.termsAndConditions.findFirst({
    where: { module: "book", status: true },
    select: { freeShippingMinimumOrderAmount: true },
  });
  return row?.freeShippingMinimumOrderAmount ?? 0;
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
 * create-order phase 1: read the active cart, validate shipping + availability,
 * compute totals (free-shipping threshold) and the priced item snapshot. NO
 * write — the controller creates the Razorpay order from `amount`, then calls
 * `writeBookOrderMysql` with the razorpay id. Splitting avoids holding a write
 * open across the external Razorpay call (mirrors the Mongo controller order).
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

/**
 * create-order phase 2: write the pending order + its item rows (ONE txn) from a
 * computed preview + the Razorpay order id/payload.
 */
export const writeBookOrderMysql = async (input: {
  customerId: number;
  orderKey: string;
  preview: BookOrderPreview;
  razorpayOrderId: string;
  razorpayOrderPayload: string;
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
  });
  return { orderId: order.id, orderKey: input.orderKey };
};

// ── cart/purchase state (catalog-book listing/detail composition) ───────────

/**
 * The customer's active-cart state for the book listing: `cartId` (the VARCHAR
 * business key, Mongo `_id`-shape) + a bookId(string)→qty map. Null cart → both
 * empty. Mirrors the Mongo listBooks cart read.
 */
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

/**
 * The set of book ids (as strings) the customer has purchased (fulfilled order
 * statuses). For the listing's `isPurchased` + the detail check.
 */
export const getPurchasedBookIdSet = async (
  customerId: number
): Promise<Set<string>> => {
  const ids = await repo.findPurchasedBookIds(customerId);
  return new Set(ids.map(String));
};

// ── verify: dual-read owner lookup ──────────────────────────────────────────

export const findBookOrderForVerify = async (
  razorpayOrderId: string,
  customerId: number
): Promise<BookOrderRow | null> => {
  const order = await repo.findOrderByRazorpay(razorpayOrderId, customerId);
  return order ? toBookOrderRow(order) : null;
};

// ── verify: transactional fulfillment ───────────────────────────────────────

/**
 * Fulfill a verified book payment. Idempotent: an already-verified order returns
 * its DTO without re-running side effects (no second AWB, no re-deactivation).
 * Otherwise ONE transaction: allocate the AWB (insert tracking row) + flip
 * order→verified + tracking_id + deactivate the cart.
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
  return toBookOrderDto(result.order, items);
};
