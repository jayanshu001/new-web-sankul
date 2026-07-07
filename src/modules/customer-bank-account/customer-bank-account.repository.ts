import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import type {
  BankAccountCreateInput,
  BankAccountUpdateInput,
} from "./customer-bank-account.types";

/** Owner-scoped where-clause + optional text search, shared by list/count. */
const buildBankAccountWhere = (customerId: number, search?: string): Prisma.CustomerBankAccountWhereInput => {
  const s = search?.trim();
  return {
    customerId,
    ...(s
      ? {
          OR: [
            { accountHolderName: { contains: s } },
            { bankName: { contains: s } },
            { accountNumber: { contains: s } },
            { ifscCode: { contains: s } },
          ],
        }
      : {}),
  };
};

/** Prisma persistence for the customer-bank-account MySQL branch. */
export const customerBankAccountRepository = {
  /** All accounts for a customer, newest first. `search` matches on account-holder
   *  name, bank name, account number, or IFSC (the natural text columns). */
  listByCustomer: (customerId: number, opts: { search?: string; skip?: number; take?: number } = {}) =>
    prisma.customerBankAccount.findMany({
      where: buildBankAccountWhere(customerId, opts.search),
      orderBy: { createdAt: "desc" },
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    }),

  /** Count for pagination over the IDENTICAL where as listByCustomer. */
  countByCustomer: (customerId: number, opts: { search?: string } = {}) =>
    prisma.customerBankAccount.count({ where: buildBankAccountWhere(customerId, opts.search) }),

  /** Single account scoped to its owner (withdrawal flow + update/delete). */
  findOwned: (id: number, customerId: number) =>
    prisma.customerBankAccount.findFirst({ where: { id, customerId } }),

  create: (input: BankAccountCreateInput) =>
    prisma.customerBankAccount.create({
      data: {
        customerId: input.customerId,
        accountHolderName: input.accountHolderName,
        ifscCode: input.ifscCode,
        accountNumber: input.accountNumber,
        bankName: input.bankName ?? null,
        branchName: input.branchName ?? null,
        city: input.city ?? null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),

  /** Owner-scoped update; returns count so caller can 404 on 0. */
  updateOwned: (id: number, customerId: number, input: BankAccountUpdateInput) =>
    prisma.customerBankAccount.updateMany({
      where: { id, customerId },
      data: {
        ...(input.accountHolderName !== undefined
          ? { accountHolderName: input.accountHolderName }
          : {}),
        ...(input.ifscCode !== undefined ? { ifscCode: input.ifscCode } : {}),
        ...(input.accountNumber !== undefined ? { accountNumber: input.accountNumber } : {}),
        ...(input.bankName !== undefined ? { bankName: input.bankName ?? null } : {}),
        ...(input.branchName !== undefined ? { branchName: input.branchName ?? null } : {}),
        ...(input.city !== undefined ? { city: input.city ?? null } : {}),
        updatedAt: new Date(),
      },
    }),

  /** Hard delete (matches Mongo `findOneAndDelete`), owner-scoped. Returns count. */
  deleteOwned: (id: number, customerId: number) =>
    prisma.customerBankAccount.deleteMany({ where: { id, customerId } }),
};
