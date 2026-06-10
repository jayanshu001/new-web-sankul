/**
 * Customer bank account service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Gated behind `isMysqlModule("customer-bank-account")`. The referral controller
 * branches on `isBankAccountMysql()`; on the MySQL path it passes the validated
 * payload (IFSC details already resolved server-side) and numeric ids here.
 *
 * The bank-account table has no cross-module dependency (unlike address→OfflineCity),
 * so this module can be enabled independently once verified.
 */
import { isMysqlModule } from "../../config/migration";
import { customerBankAccountRepository as repo } from "./customer-bank-account.repository";
import { toBankAccountDto } from "./customer-bank-account.transformer";
import type {
  BankAccountCreateInput,
  BankAccountUpdateInput,
} from "./customer-bank-account.types";

export const BANK_ACCOUNT_MODULE = "customer-bank-account";
export const isBankAccountMysql = (): boolean => isMysqlModule(BANK_ACCOUNT_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseBankAccountId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

type Result<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; message: string };

export const listBankAccounts = async (customerId: number) => {
  const rows = await repo.listByCustomer(customerId);
  return rows.map(toBankAccountDto);
};

/** Owner-scoped fetch (withdrawal flow). Returns null if not found/owned. */
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

export const deleteBankAccount = async (id: number, customerId: number): Promise<Result<null>> => {
  const res = await repo.deleteOwned(id, customerId);
  if (res.count === 0) return { ok: false, status: 404, message: "Bank account not found." };
  return { ok: true, status: 200, data: null };
};
