// Customer bank accounts: owner-scoped Prisma queries with search.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type {
  BankAccountCreateInput,
  BankAccountUpdateInput,
} from "./customer-bank-account.types";

const buildBankAccountWhere = (customerId: number, search?: string): Prisma.CustomerBankAccountWhereInput => {
  const s = buildPrismaSearch(search, [
    "accountHolderName",
    "bankName",
    "accountNumber",
    "ifscCode",
  ]);
  return {
    customerId,
    ...(s ?? {}),
  };
};

export const customerBankAccountRepository = {
  listByCustomer: (customerId: number, opts: { search?: string; skip?: number; take?: number } = {}) =>
    prisma.customerBankAccount.findMany({
      where: buildBankAccountWhere(customerId, opts.search),
      orderBy: { createdAt: "desc" },
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    }),

  countByCustomer: (customerId: number, opts: { search?: string } = {}) =>
    prisma.customerBankAccount.count({ where: buildBankAccountWhere(customerId, opts.search) }),

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

  /** Hard delete, not soft. */
  deleteOwned: (id: number, customerId: number) =>
    prisma.customerBankAccount.deleteMany({ where: { id, customerId } }),
};
