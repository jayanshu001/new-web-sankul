import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for the client book-cart MySQL branch.
 * Mongo BookCart embeds items[]; SQL splits into ws_book_cart (one active row
 * per customer) + ws_book_cart_item (one row per book line). The active flag is
 * `status` (Prisma `active`). cart_id is a VARCHAR business key (NOT NULL).
 */
const genCartId = (): string =>
  `cart-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export const clientCartRepository = {
  bookExists: (id: number) =>
    prisma.book.findUnique({ where: { id }, select: { id: true } }),

  /** The active cart (with item rows + book) for a customer, or null. */
  findActiveCart: (customerId: number) =>
    prisma.bookCart.findFirst({
      where: { userId: customerId, active: true },
      include: { bookCartItem: { include: { book: true } } },
      orderBy: { id: "desc" },
    }),

  findActiveCartBare: (customerId: number) =>
    prisma.bookCart.findFirst({
      where: { userId: customerId, active: true },
      include: { bookCartItem: true },
      orderBy: { id: "desc" },
    }),

  /**
   * Get-or-create the customer's active cart; returns the cart row.
   *
   * `user_ip_address` holds the last address the cart was acted from. A cart
   * outlives a session, so it is refreshed when the caller's IP differs from
   * the stored one — that also fills the column on carts created before it was
   * mapped. The extra UPDATE only fires on an actual change, never per read.
   */
  ensureCart: async (customerId: number, userIpAddress: string | null = null) => {
    const existing = await prisma.bookCart.findFirst({ where: { userId: customerId, active: true }, orderBy: { id: "desc" } });
    if (existing) {
      if (userIpAddress && existing.userIpAddress !== userIpAddress) {
        return prisma.bookCart.update({
          where: { id: existing.id },
          data: { userIpAddress, updated_at: new Date() },
        });
      }
      return existing;
    }
    return prisma.bookCart.create({
      data: { cart_id: genCartId(), userId: customerId, userIpAddress, active: true, created_at: new Date(), updated_at: new Date() },
    });
  },

  findCartItem: (cartId: number, bookId: number) =>
    prisma.bookCartItem.findFirst({ where: { cartId, bookId } }),

  incrementItem: (id: number, by: number) =>
    prisma.bookCartItem.update({ where: { id }, data: { qty: { increment: by } } }),

  setItemQty: (id: number, qty: number) =>
    prisma.bookCartItem.update({ where: { id }, data: { qty } }),

  addItem: (cartId: number, bookId: number, qty: number) =>
    prisma.bookCartItem.create({ data: { cartId, bookId, qty } }),

  removeItem: (id: number) => prisma.bookCartItem.delete({ where: { id } }),

  countCartItems: (cartId: number) => prisma.bookCartItem.count({ where: { cartId } }),

  deleteCart: (id: number) => prisma.bookCart.delete({ where: { id } }),

  touchCart: (id: number) =>
    prisma.bookCart.update({ where: { id }, data: { updated_at: new Date() } }),

  attachShipping: (cartId: number, shippingId: number) =>
    prisma.bookCart.update({ where: { id: cartId }, data: { shippingId, updated_at: new Date() } }),

  // ── shipping (CustomerShipping find-or-create) ──────────────────────────────
  findShipping: (userId: number, name: string, phone: bigint, address: string, pincode: number) =>
    prisma.customerShipping.findFirst({ where: { userId, name, phone, address, pincode } }),

  createShipping: (data: any) => prisma.customerShipping.create({ data }),
  updateShipping: (id: number, data: any) => prisma.customerShipping.update({ where: { id }, data }),

  /** Owner-scoped delivery address; `status: true` skips soft-deleted rows so a
   *  removed address can't be re-selected at checkout. */
  findAddress: (id: number, userId: number) =>
    prisma.customerAddress.findFirst({ where: { id, userId, status: true } }),

  findCustomerContact: (id: number) =>
    prisma.customer.findUnique({ where: { id }, select: { phoneNumber: true, emailAddress: true } }),
};
