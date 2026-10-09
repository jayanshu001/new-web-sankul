// Book cart: add/update/remove items, cart summary and shipping attach.
import { clientCartRepository as repo } from "./client-cart.repository";
import { resolveShippingIdForAddress } from "../customer-shipping/customer-shipping.service";
import { getFreeShippingMin } from "../book-order/book-order.service";
import { parsePositiveInt } from "../../utils/parseId";

export const parseCartId = parsePositiveInt;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const toCartDto = (cart: any) => ({
  _id: !!cart?.id ? String(cart.id) : null,
  items: (cart?.bookCartItem ?? []).map((it: any) => ({ bookId: String(it.bookId), qty: it.qty })),
  shippingId: !!cart?.shippingId ? String(cart.shippingId) : null,
});

// Creates the cart on first add; an existing line is incremented, not replaced.
export const addToCart = async (customerId: number, bookId: number, qty: number, userIpAddress: string | null = null) => {
  if (!(await repo.bookExists(bookId))) return { ok: false as const, reason: "book_not_found" as const };
  const cart = await repo.ensureCart(customerId, userIpAddress);
  const existing = await repo.findCartItem(cart.id, bookId);
  if (existing) {
    await repo.incrementItem(existing.id, qty);
  } else {
    await repo.addItem(cart.id, bookId, qty);
  }
  await repo.touchCart(cart.id);
  const fresh = await repo.findActiveCartBare(customerId);
  return { ok: true as const, data: toCartDto(fresh), created: !existing };
};

export const updateCartItemQty = async (customerId: number, bookId: number, qty: number) => {
  const cart = await repo.findActiveCartBare(customerId);
  if (!cart) return { ok: false as const };
  const item = await repo.findCartItem(cart.id, bookId);
  if (!item) return { ok: false as const };
  await repo.setItemQty(item.id, qty);
  await repo.touchCart(cart.id);
  const fresh = await repo.findActiveCartBare(customerId);
  return { ok: true as const, data: toCartDto(fresh) };
};

export const removeCartItem = async (customerId: number, bookId: number) => {
  const cart = await repo.findActiveCartBare(customerId);
  if (!cart) return { ok: false as const };
  const item = await repo.findCartItem(cart.id, bookId);
  if (!item) return { ok: false as const };
  await repo.removeItem(item.id);

  const remaining = await repo.countCartItems(cart.id);
  if (!remaining) {
    await repo.deleteCart(cart.id);
    return { ok: true as const, data: { _id: null, items: [], shippingId: null } };
  }

  await repo.touchCart(cart.id);
  const fresh = await repo.findActiveCartBare(customerId);
  return { ok: true as const, data: toCartDto(fresh) };
};

// Lines plus price summary; shipping waived at the free-shipping minimum (same rule as checkout).
export const getCart = async (customerId: number) => {
  const cart = await repo.findActiveCart(customerId);
  if (!cart || cart.bookCartItem.length === 0) {
    return {
      _id: cart ? String(cart.id) : null,
      items: [],
      summary: {
        subtotal: 0, listTotal: 0, discount: 0, itemCount: 0, shipping: 0, shippingWaived: true, total: 0,
        breakdown: { totalListPrice: 0, totalDiscountedPrice: 0, shipping: 0, shippingWaived: true },
      },
    };
  }
  let subtotal = 0, listTotal = 0, itemCount = 0, rawShipping = 0;
  const items = cart.bookCartItem
    .filter((line: any) => line.book)
    .map((line: any) => {
      const book = line.book;
      const lineSubtotal = num(book.discounted_price) * line.qty;
      const lineList = num(book.list_price) * line.qty;
      subtotal += lineSubtotal;
      listTotal += lineList;
      itemCount += line.qty;
      rawShipping += num(book.shipping_price) * line.qty;
      return { bookId: String(line.bookId), qty: line.qty, book, lineSubtotal, lineList };
    });

  // Same free-shipping rule as create-order so the cart total matches the charged
  // amount. Shipping is not address-based; the address only gates checkout.
  const freeShippingMin = await getFreeShippingMin();
  const shippingWaived = freeShippingMin > 0 && subtotal >= freeShippingMin;
  const shipping = shippingWaived ? 0 : rawShipping;
  const total = subtotal + shipping;
  return {
    _id: String(cart.id),
    items,
    summary: {
      subtotal,
      listTotal,
      discount: Math.max(0, listTotal - subtotal),
      itemCount,
      shipping,
      shippingWaived,
      total,
      breakdown: { totalListPrice: listTotal, totalDiscountedPrice: subtotal, shipping, shippingWaived },
    },
  };
};

// Snapshots an address-book entry into ws_customer_shipping and links it to the cart.
export const attachShipping = async (
  customerId: number,
  addressId: number,
  userIpAddress: string | null = null
): Promise<{ ok: false; reason: "address" | "phone" | "city" } | { ok: true; cart: any; shipping: any }> => {
  const resolved = await resolveShippingIdForAddress(customerId, addressId);
  if (!resolved.ok) {
    const reason = resolved.reason === "address_not_found" ? "address" : resolved.reason === "phone_missing" ? "phone" : "city";
    return { ok: false, reason };
  }

  const cart = await repo.ensureCart(customerId, userIpAddress);
  await repo.attachShipping(cart.id, resolved.shippingId);
  const fresh = await repo.findActiveCartBare(customerId);
  return {
    ok: true,
    cart: toCartDto(fresh),
    shipping: { _id: String(resolved.shippingId), city: resolved.city, phone: String(resolved.phone) },
  };
};

export { toCartDto };
