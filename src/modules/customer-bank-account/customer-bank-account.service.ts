// Customer bank accounts: list and CRUD of the bank accounts a customer saves for referral payouts.
import { customerBankAccountRepository as repo } from "./customer-bank-account.repository";
import { toBankAccountDto } from "./customer-bank-account.transformer";
import type {
  BankAccountCreateInput,
  BankAccountUpdateInput,
} from "./customer-bank-account.types";

export const parseBankAccountId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export const listBankAccounts = async (
  customerId: number,
  opts: { search?: string; skip?: number; take?: number } = {}
) => {
  const [rows, total] = await Promise.all([
    repo.listByCustomer(customerId, opts),
    repo.countByCustomer(customerId, opts),
  ]);
  return { items: rows.map(toBankAccountDto), total };
};

export const getBankAccount = async (id: number, customerId: number) => {
  const row = await repo.findOwned(id, customerId);
  return row ? toBankAccountDto(row) : null;
};

export const createBankAccount = async (input: BankAccountCreateInput) => {
  const row = await repo.create(input);
  return toBankAccountDto(row);
};

export const updateBankAccount = async (
  id: number,
  customerId: number,
  input: BankAccountUpdateInput
): Promise<Result<ReturnType<typeof toBankAccountDto>>> => {
  const res = await repo.updateOwned(id, customerId, input);
  if (res.count === 0) return { ok: false, status: 404, message: "Bank account not found." };
  const row = await repo.findOwned(id, customerId);
  if (!row) return { ok: false, status: 404, message: "Bank account not found." };
  return { ok: true, status: 200, data: toBankAccountDto(row) };
};

// Hard delete; 404 when not owned.
export const deleteBankAccount = async (id: number, customerId: number): Promise<Result<null>> => {
  const res = await repo.deleteOwned(id, customerId);
  if (res.count === 0) return { ok: false, status: 404, message: "Bank account not found." };
  return { ok: true, status: 200, data: null };
};
