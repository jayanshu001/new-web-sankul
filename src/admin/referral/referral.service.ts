// src/admin/referral/referral.service.ts
//
// Domain logic for admin referral endpoints. Withdrawals + reward adjustments
// are financial mutations — the controller layer enforces `Idempotency-Key`
// (see referral.routes.ts).

import { HttpError } from "../../middlewares/errorHandler";
import * as refSql from "../../modules/referral/referral.service";

const { parseId } = refSql;

// ──────────────────────────────────────────────────────────────────────────────
// Programs (small master)
// ──────────────────────────────────────────────────────────────────────────────

export interface ListProgramsQuery {
  search?: string;
  sortBy?: string; // name | title | createdAt
  sortOrder?: string;
  page?: string;
  limit?: string;
}

/**
 * Programs list with optional title/name search + sort. Pagination is opt-in
 * (page/limit present → `pagination` block; absent → flat array — back-compat).
 */
export const listPrograms = async (query: ListProgramsQuery = {}) => {
  const paginate = query.page !== undefined || query.limit !== undefined;
  const pageNum = Math.max(parseInt(query.page ?? "1", 10) || 1, 1);
  const limitNum = Math.max(parseInt(query.limit ?? "20", 10) || 20, 1);
  const sortDir: "asc" | "desc" = query.sortOrder === "desc" ? "desc" : "asc";

  const { data, total } = await refSql.adminListPrograms({
    search: query.search, sortBy: query.sortBy, sortDir,
    ...(paginate ? { skip: (pageNum - 1) * limitNum, take: limitNum } : {}),
  });
  return paginate
    ? { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } }
    : { data };
};

export const getProgramById = async (id: string) => {
  const numId = parseId(id);
  if (!numId) throw new HttpError(400, "Invalid program id.");
  const program = await refSql.adminGetProgram(numId);
  if (!program) throw new HttpError(404, "Program not found.");
  return program;
};

export const createProgram = async (validated: any) => {
  if (validated.name && (await refSql.adminProgramNameExists(validated.name))) {
    throw new HttpError(409, "Program name already exists.");
  }
  return refSql.adminCreateProgram(validated);
};

export const updateProgram = async (id: string, validated: any) => {
  const numId = parseId(id);
  if (!numId) throw new HttpError(400, "Invalid program id.");
  if (!(await refSql.adminGetProgram(numId))) throw new HttpError(404, "Program not found.");
  if (validated.name && (await refSql.adminProgramNameExists(validated.name, numId))) {
    throw new HttpError(409, "Program name already exists.");
  }
  return refSql.adminUpdateProgram(numId, validated);
};

export const deleteProgram = async (id: string) => {
  const numId = parseId(id);
  if (!numId) throw new HttpError(400, "Invalid program id.");
  if (!(await refSql.adminGetProgram(numId))) throw new HttpError(404, "Program not found.");
  await refSql.adminDeleteProgram(numId);
};

// ──────────────────────────────────────────────────────────────────────────────
// Transactions
// ──────────────────────────────────────────────────────────────────────────────

export interface ListTransactionsQuery {
  customerId?: string;
  type?: string;
  status?: string;
  fromDate?: string;
  toDate?: string;
  page?: string;
  limit?: string;
}

export const listTransactions = async (query: ListTransactionsQuery) => {
  const { customerId, type, status, fromDate, toDate, page = "1", limit = "20" } = query;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const { data, total } = await refSql.adminListTransactions({ customerId, type, status, fromDate, toDate, page: pageNum, limit: limitNum });
  return { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

export const updateWithdrawalStatus = async (
  id: string,
  validated: { status: string; description?: string }
) => {
  const numId = parseId(id);
  if (!numId) throw new HttpError(400, "Invalid transaction id.");
  const r = await refSql.adminUpdateWithdrawalStatus(numId, validated.status, validated.description);
  if (!r.ok) {
    if (r.reason === "not_found") throw new HttpError(404, "Transaction not found.");
    if (r.reason === "not_debit") throw new HttpError(400, "Only debit withdrawal transactions can have status updated.");
    throw new HttpError(400, "Invalid status.");
  }
  return r.data;
};

export const rejectWithdrawal = async (id: string) => {
  const numId = parseId(id);
  if (!numId) throw new HttpError(400, "Invalid transaction id.");
  const r = await refSql.adminRejectWithdrawal(numId);
  if (!r.ok) {
    if (r.reason === "not_found") throw new HttpError(404, "Transaction not found.");
    if (r.reason === "not_debit") throw new HttpError(400, "Only withdrawal debits can be rejected.");
    throw new HttpError(400, "Only pending withdrawals can be rejected.");
  }
  return;
};

// ──────────────────────────────────────────────────────────────────────────────
// Withdrawal Report (admin "Referral Report" screen)
// ──────────────────────────────────────────────────────────────────────────────

export interface WithdrawalsReportQuery {
  fromDate?: string;
  toDate?: string;
  // Unified cross-report name for the createdAt window (reports-date-filter-created-at.md);
  // fromDate/toDate kept as legacy aliases. Bounds `ws_refferal_transaction.created_at`.
  createdFrom?: string;
  createdTo?: string;
  status?: string;
  search?: string;
  page?: string;
  limit?: string;
}

export const getWithdrawalsReport = async (query: WithdrawalsReportQuery) => {
  const { fromDate, toDate, createdFrom, createdTo, status, search, page = "1", limit = "10" } = query;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
  const { data, total } = await refSql.adminWithdrawalsReport({ status, fromDate: createdFrom ?? fromDate, toDate: createdTo ?? toDate, search, page: pageNum, limit: limitNum });
  return { data, pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) } };
};

// ──────────────────────────────────────────────────────────────────────────────
// Withdrawal CSV export
// ──────────────────────────────────────────────────────────────────────────────

export interface WithdrawalsCsvQuery {
  fromDate?: string;
  toDate?: string;
  // Unified createdAt-window name; fromDate/toDate kept as legacy aliases.
  createdFrom?: string;
  createdTo?: string;
  status?: string;
}

export const buildWithdrawalsCsv = async (query: WithdrawalsCsvQuery): Promise<string> => {
  const { fromDate, toDate, createdFrom, createdTo, status } = query;
  return refSql.adminWithdrawalsCsv({ status, fromDate: createdFrom ?? fromDate, toDate: createdTo ?? toDate });
};

// ──────────────────────────────────────────────────────────────────────────────
// Manual reward adjustment
// ──────────────────────────────────────────────────────────────────────────────

export const adjustCustomerRewards = async (
  customerId: string,
  input: { amount: number; type: "credit" | "debit"; description?: string }
) => {
  const { amount, type, description } = input;

  const numId = parseId(customerId);
  if (!numId) throw new HttpError(400, "Invalid customer id.");
  const r = await refSql.adminAdjustRewards(numId, { amount, type, description });
  if (!r.ok) {
    if (r.reason === "not_found") throw new HttpError(404, "Customer not found.");
    throw new HttpError(400, "Debit amount exceeds customer's reward points.");
  }
  return r.data;
};

// ──────────────────────────────────────────────────────────────────────────────
// Referrers listing — aggregated stats per customer with a referral code
// ──────────────────────────────────────────────────────────────────────────────

export interface ReferrersQuery {
  search?: string;
  sort?: string;
  hasWithdrawn?: string;
  minEarned?: string;
  page?: string;
  limit?: string;
}

export const listReferrers = async (query: ReferrersQuery) => {
  const {
    search,
    sort = "earned",
    hasWithdrawn,
    minEarned,
    page = "1",
    limit = "20",
  } = query;

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);

  const { data } = await refSql.adminListReferrers({ search, sort, hasWithdrawn, minEarned, page: pageNum, limit: limitNum });
  return { data, pagination: { total: data.length, page: pageNum, limit: limitNum, totalPages: data.length < limitNum ? pageNum : pageNum + 1 } };
};
