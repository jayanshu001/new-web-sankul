// Customer shipping: Prisma queries for address lookups and shipping snapshots.
import { prisma } from "../../config/prisma";

/** `ws_customer_shipping` is the per-order dispatch address; the snapshot rule lives in the service. */
export const customerShippingRepository = {
  /**
   * Skips soft-deleted rows so a removed address can't be re-selected at checkout.
   * The backfill passes `includeSoftDeleted` to repair orders placed against
   * since-deleted addresses.
   */
  findAddress: (id: number, userId: number, includeSoftDeleted = false) =>
    prisma.customerAddress.findFirst({
      where: { id, userId, ...(includeSoftDeleted ? {} : { status: true }) },
    }),

  findCustomerContact: (id: number) =>
    prisma.customer.findUnique({ where: { id }, select: { phoneNumber: true, emailAddress: true } }),

  /**
   * Identity = (owner, name, phone, address, pincode), the book-cart key, so all
   * order types share one snapshot per address instead of a row per checkout.
   */
  findShipping: (userId: number, name: string, phone: bigint, address: string, pincode: number) =>
    prisma.customerShipping.findFirst({ where: { userId, name, phone, address, pincode } }),

  createShipping: (data: any) => prisma.customerShipping.create({ data }),
  updateShipping: (id: number, data: any) => prisma.customerShipping.update({ where: { id }, data }),

  /** Used by the backfill. */
  shippingExists: (id: number) =>
    prisma.customerShipping.findFirst({ where: { id }, select: { id: true } }),
};
