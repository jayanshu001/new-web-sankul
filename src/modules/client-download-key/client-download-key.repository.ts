// Download encryption key: Prisma queries on ws_customer.download_key_hex.
import { prisma } from "../../config/prisma";

/**
 * Every read selects only the key column so `password`/`otp` are never loaded,
 * and every query is scoped by the customer PK.
 */
export const downloadKeyRepository = {
  /** `null` row = no such customer; `{ downloadKeyHex: null }` = customer with no key yet. */
  findByCustomer: (customerId: number) =>
    prisma.customer.findFirst({
      where: { id: customerId, isAccountDeleted: false },
      select: { downloadKeyHex: true },
    }),

  /**
   * `updateMany` so a missing or soft-deleted customer yields `count: 0` (the
   * caller answers 401) instead of throwing P2025.
   */
  setKey: (customerId: number, keyHex: string) =>
    prisma.customer.updateMany({
      where: { id: customerId, isAccountDeleted: false },
      data: { downloadKeyHex: keyHex, updatedAt: new Date() },
    }),

  clearKey: (customerId: number) =>
    prisma.customer.updateMany({
      where: { id: customerId },
      data: { downloadKeyHex: null },
    }),
};
