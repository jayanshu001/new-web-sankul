import type { CustomerBankAccount } from "@prisma/client";
import type { BankAccountDto } from "./customer-bank-account.types";

export const toBankAccountDto = (row: CustomerBankAccount): BankAccountDto => ({
  _id: String(row.id),
  customerId: String(row.customerId),
  accountHolderName: row.accountHolderName,
  ifscCode: row.ifscCode,
  accountNumber: row.accountNumber,
  bankName: row.bankName ?? null,
  branchName: row.branchName ?? null,
  city: row.city ?? null,
  createdAt: row.createdAt ?? null,
  updatedAt: row.updatedAt ?? null,
});
