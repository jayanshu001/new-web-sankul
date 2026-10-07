// Customer bank accounts: DTO and input types.

/** `bankName`/`branchName`/`city` are resolved server-side from IFSC, not client input. */
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
