// Book cart: Prisma queries for carts, cart items and shipping snapshots.
import { prisma } from "../../config/prisma";

const genCartId = (): string =>
  `cart-${Date.now().toString(36)}${Math.floor(Math.random() * 1e6).toString(36)}`;

export const clientCartRepository = {
  bookExists: (id: number) =>
    prisma.book.findUnique({ where: { id }, select: { id: true } }),

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
   * `user_ip_address` holds the last IP the cart was acted from (a cart outlives a
   * session); it is updated only when it actually changes.
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

  findShipping: (userId: number, name: string, phone: bigint, address: string, pincode: number) =>
    prisma.customerShipping.findFirst({ where: { userId, name, phone, address, pincode } }),

  createShipping: (data: any) => prisma.customerShipping.create({ data }),
  updateShipping: (id: number, data: any) => prisma.customerShipping.update({ where: { id }, data }),

  /** `status: true` skips soft-deleted addresses so a removed one can't be selected at checkout. */
  findAddress: (id: number, userId: number) =>
    prisma.customerAddress.findFirst({ where: { id, userId, status: true } }),

  findCustomerContact: (id: number) =>
    prisma.customer.findUnique({ where: { id }, select: { phoneNumber: true, emailAddress: true } }),
};
