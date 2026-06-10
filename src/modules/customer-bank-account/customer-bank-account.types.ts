/**
 * Customer bank account — MySQL (Prisma) branch types.
 *
 * Table `ws_customer_bank_account`. The live DB has all columns the Prisma model
 * declares (account_holder_name, ifsc_code, account_number, bank_name,
 * branch_name, city) — no phantom-column mismatch, unlike the address table.
 *
 * Used by the referral withdrawal flow. The DTO returns string ids (Mongo
 * `_id`-shape compatible). `bankName`/`branchName`/`city` are derived server-side
 * from an IFSC lookup (not client input).
 */

export interface BankAccountDto {
  _id: string;
  customerId: string;
  accountHolderName: string;
  ifscCode: string;
  accountNumber: string;
  bankName: string | null;
  branchName: string | null;
  city: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface BankAccountCreateInput {
  customerId: number;
  accountHolderName: string;
  ifscCode: string;
  accountNumber: string;
  bankName?: string | null;
  branchName?: string | null;
  city?: string | null;
}

export type BankAccountUpdateInput = Partial<Omit<BankAccountCreateInput, "customerId">>;
