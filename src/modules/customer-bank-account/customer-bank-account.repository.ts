import { prisma } from "../../config/prisma";
import type {
  BankAccountCreateInput,
  BankAccountUpdateInput,
} from "./customer-bank-account.types";

/** Prisma persistence for the customer-bank-account MySQL branch. */
export const customerBankAccountRepository = {
  /** All accounts for a customer, newest first. */
  listByCustomer: (customerId: number) =>
    prisma.customerBankAccount.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
    }),

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
