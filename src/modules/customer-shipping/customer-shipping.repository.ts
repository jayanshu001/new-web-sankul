import { prisma } from "../../config/prisma";

/**
 * Prisma persistence for `ws_customer_shipping` — the per-ORDER dispatch address.
 * Queries only; the address→shipping snapshot rule lives in the service.
 */
export const customerShippingRepository = {
  /**
   * Owner-scoped delivery address. `status: true` skips soft-deleted rows so a
   * removed address can't be re-selected at checkout — the backfill passes
   * `includeSoftDeleted` because an order placed against an address the customer
   * has since deleted still has to be repaired.
   */
  findAddress: (id: number, userId: number, includeSoftDeleted = false) =>
    prisma.customerAddress.findFirst({
      where: { id, userId, ...(includeSoftDeleted ? {} : { status: true }) },
    }),

  findCustomerContact: (id: number) =>
    prisma.customer.findUnique({ where: { id }, select: { phoneNumber: true, emailAddress: true } }),

  /**
   * Identity of a shipping row = (owner, name, phone, address, pincode). Same
   * key the book-cart flow has always used; keeping it identical is what lets
   * books and package/course orders share one snapshot per address instead of
   * accumulating a near-duplicate row per checkout.
   */
  findShipping: (userId: number, name: string, phone: bigint, address: string, pincode: number) =>
    prisma.customerShipping.findFirst({ where: { userId, name, phone, address, pincode } }),

  createShipping: (data: any) => prisma.customerShipping.create({ data }),
  updateShipping: (id: number, data: any) => prisma.customerShipping.update({ where: { id }, data }),

  /** Does this id already denote a real shipping row? Used by the backfill. */
  shippingExists: (id: number) =>
    prisma.customerShipping.findFirst({ where: { id }, select: { id: true } }),
};
