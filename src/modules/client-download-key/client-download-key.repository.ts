import { prisma } from "../../config/prisma";

/**
 * Prisma access for `ws_customer.download_key_hex`. No business logic here —
 * the "is this the same key we already hold?" decision lives in the service.
 *
 * Every read uses an explicit `select` of just the key column. That is
 * deliberate: most customer reads in this codebase pull the whole row, and this
 * module has no reason to hold `password` / `otp` / the rest of the row in
 * memory just to answer with 64 hex characters.
 *
 * Every method is scoped by `id` (the customer PK), so no query shape in this
 * file can reach across accounts.
 */
export const downloadKeyRepository = {
  /** `null` row = no such customer; `{ downloadKeyHex: null }` = customer with no key yet. */
  findByCustomer: (customerId: number) =>
    prisma.customer.findFirst({
      where: { id: customerId, isAccountDeleted: false },
      select: { downloadKeyHex: true },
    }),

  /**
   * Store / replace this customer's key.
   *
   * `updateMany` (not `update`) so a missing or soft-deleted customer comes back
   * as `count: 0` instead of throwing P2025 — the caller turns that into a 401
   * rather than a 500. `updatedAt` is set explicitly to match every other write
   * in customer-profile.repository.ts.
   */
  setKey: (customerId: number, keyHex: string) =>
    prisma.customer.updateMany({
      where: { id: customerId, isAccountDeleted: false },
      data: { downloadKeyHex: keyHex, updatedAt: new Date() },
    }),

  /** Account deletion — clears this customer's key only. */
  clearKey: (customerId: number) =>
    prisma.customer.updateMany({
      where: { id: customerId },
      data: { downloadKeyHex: null },
    }),
};
