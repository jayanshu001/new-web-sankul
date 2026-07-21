import { clientCartRepository as repo } from "./client-cart.repository";
import { isOfflineCityMysql, resolveCityName } from "../offline-city/offline-city.service";
import { getFreeShippingMin } from "../book-order/book-order.service";

export const CLIENT_CART_MODULE = "client-cart";
export const isClientCartMysql = (): boolean => true;

export const parseCartId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** Mongo-shaped cart DTO: { _id, items[{bookId,qty,...}], shippingId }. */
const toCartDto = (cart: any) => ({
  _id: String(cart.id),
  items: (cart.bookCartItem ?? []).map((it: any) => ({ bookId: String(it.bookId), qty: it.qty })),
  shippingId: cart.shippingId != null ? String(cart.shippingId) : null,
});

// ─── add / update / remove ────────────────────────────────────────────────────
export const addToCart = async (customerId: number, bookId: number, qty: number) => {
  if (!(await repo.bookExists(bookId))) return { ok: false as const, reason: "book_not_found" as const };
  const cart = await repo.ensureCart(customerId);
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
  await repo.touchCart(cart.id);
  const fresh = await repo.findActiveCartBare(customerId);
  return { ok: true as const, data: toCartDto(fresh) };
};

// ─── get cart (with totals) ───────────────────────────────────────────────────
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
      // The Prisma Book row uses snake_case price columns (list_price,
      // discounted_price, shipping_price) — NOT camelCase.
      const lineSubtotal = num(book.discounted_price) * line.qty;
      const lineList = num(book.list_price) * line.qty;
      subtotal += lineSubtotal;
      listTotal += lineList;
      itemCount += line.qty;
      // Per-unit shipping; the free-shipping threshold below may waive it.
      rawShipping += num(book.shipping_price) * line.qty;
      return { bookId: String(line.bookId), qty: line.qty, book, lineSubtotal, lineList };
    });

  // Use the SAME free-shipping logic as create-order (book-order.service) so the
  // cart total and the charged amount always agree: shipping is waived when the
  // discounted subtotal meets the configured minimum. (Shipping is NOT address-
  // based — the address only gates checkout, not the amount.)
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

// ─── attach shipping ──────────────────────────────────────────────────────────
export const attachShipping = async (
  customerId: number,
  addressId: number
): Promise<{ ok: false; reason: "address" | "phone" | "city" } | { ok: true; cart: any; shipping: any }> => {
  const address = await repo.findAddress(addressId, customerId);
  if (!address) return { ok: false, reason: "address" };

  // Address carries phone (BigInt) + email; fall back to the customer profile.
  let phone = address.phone ?? BigInt(0);
  let email = address.email ?? "";
  if (!phone || !email) {
    const c = await repo.findCustomerContact(customerId);
    if (!phone && c?.phoneNumber) phone = BigInt(c.phoneNumber);
    email = email || c?.emailAddress || "";
  }
  if (!phone) return { ok: false, reason: "phone" };

  let cityName = "";
  if (address.cityId && isOfflineCityMysql()) {
    const city = await resolveCityName(address.cityId);
    cityName = city?.name ?? "";
  }
  // Legacy addresses (created before the city-picker) have cityId = NULL but DO
  // carry the city as a free-text string on the row itself. Fall back to it so
  // old customers can check out without being forced to re-edit their address.
  if (!cityName) cityName = (address.city ?? "").trim();
  if (!cityName) return { ok: false, reason: "city" };

  const existing = await repo.findShipping(customerId, address.name, phone, address.address, address.pincode);
  const shipData = {
    userId: customerId, name: address.name, phone,
    alternate_phone: address.alternate_phone ?? null,
    email, address: address.address, address_2: address.address_2 ?? "",
    city: cityName.slice(0, 20), state: address.state ?? null, pincode: address.pincode, status: true,
    created_at: new Date(), updated_at: new Date(),
  };
  const shipping = existing
    ? await repo.updateShipping(existing.id, shipData)
    : await repo.createShipping(shipData);

  const cart = await repo.ensureCart(customerId);
  await repo.attachShipping(cart.id, shipping.id);
  const fresh = await repo.findActiveCartBare(customerId);
  return { ok: true, cart: toCartDto(fresh), shipping: { _id: String(shipping.id), city: cityName } };
};

export { toCartDto };
