import { isMysqlModule } from "../../config/migration";
import { referralRepository as repo } from "./referral.repository";
import type { RefferalProgram, RefferalTransaction } from "@prisma/client";

export const REFERRAL_MODULE = "referral";
export const isReferralMysql = (): boolean => isMysqlModule(REFERRAL_MODULE);

export const parseCustomerId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const splitName = (full: string | null | undefined) => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] ?? "",
    middleName: parts.length > 2 ? parts.slice(1, -1).join(" ") : "",
    lastName: parts.length > 1 ? parts[parts.length - 1] : "",
  };
};

// Program → Mongo-shaped DTO (the client reads referralDiscount/referralReward).
const toProgramDto = (p: RefferalProgram) => ({
  _id: String(p.id),
  name: p.name,
  title: p.title,
  image: p.image,
  referralDiscount: Number(p.refferalDiscount) || 0,
  referralReward: Number(p.refferalReward) || 0,
  minimumPrice: p.minimumPrice,
  initialRewardAmount: p.initialRewardAmount,
  video: p.video,
  status: p.status ?? false,
});

const toTransactionDto = (t: RefferalTransaction) => ({
  _id: String(t.id),
  orderId: t.orderId != null ? String(t.orderId) : null,
  customerId: String(t.customerId),
  bankAccount: t.bankAccount ?? null,
  description: t.description,
  coin: t.coin,
  type: t.type,
  status: t.status,
  providerRef: t.providerRef ?? null,
  failureReason: t.failureReason ?? null,
  createdAt: t.createdAt ?? null,
  updatedAt: t.updatedAt ?? null,
});

// ─── Rewards overview ────────────────────────────────────────────────────────
export const getRewardsOverview = async (customerId: number) => {
  const customer = await repo.findRewardCustomer(customerId);
  if (!customer) return null;
  const program = await repo.listActiveProgramsByName("student");
  const name = splitName(customer.fullName);
  return {
    customer: {
      id: String(customer.id),
      firstName: name.firstName,
      middleName: name.middleName,
      lastName: name.lastName,
      phoneNumber: customer.phoneNumber,
      referralCode: customer.referralCode ?? null,
      rewardPoints: customer.rewardPoints ?? 0,
    },
    program: program.map(toProgramDto),
  };
};

export const getReferralStatus = async () => {
  const program = await repo.findActiveProgramByName("student");
  return {
    enabled: !!program,
    referralDiscount: program ? Number(program.refferalDiscount) || 0 : 0,
    referralReward: program ? Number(program.refferalReward) || 0 : 0,
    minimumPrice: program?.minimumPrice ?? 0,
  };
};

// ─── Transactions ────────────────────────────────────────────────────────────
export const listTransactions = async (
  customerId: number,
  opts: { type?: string; page: number; limit: number }
) => {
  const type = opts.type === "credit" || opts.type === "debit" ? opts.type : undefined;
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    repo.listTransactions(customerId, { type, skip, take: opts.limit }),
    repo.countTransactions(customerId, { type }),
  ]);
  return { items: rows.map(toTransactionDto), total };
};

export const getTransaction = async (id: number, customerId: number) => {
  const t = await repo.findTransaction(id, customerId);
  return t ? toTransactionDto(t) : null;
};

// ─── Generate referral code ──────────────────────────────────────────────────
export const generateReferralCode = async (
  customerId: number,
  code: string
): Promise<{ ok: boolean; reason?: "not_found" | "already" | "taken"; data?: any }> => {
  const customer = await repo.findRewardCustomer(customerId);
  if (!customer) return { ok: false, reason: "not_found" };
  if (customer.referralCode) return { ok: false, reason: "already" };
  if (await repo.referralCodeTaken(code)) return { ok: false, reason: "taken" };

  const updated = await repo.setReferralCode(customerId, code);
  const name = splitName(updated.fullName);
  return {
    ok: true,
    data: {
      _id: String(updated.id),
      firstName: name.firstName,
      lastName: name.lastName,
      phoneNumber: updated.phoneNumber,
      referralCode: updated.referralCode,
      rewardPoints: updated.rewardPoints ?? 0,
    },
  };
};

// ─── Withdrawal (DB side; the controller handles RazorpayX + refund) ─────────
export const getRewardPoints = async (customerId: number): Promise<number | null> => {
  const c = await repo.findRewardCustomer(customerId);
  return c ? c.rewardPoints ?? 0 : null;
};

export const createWithdrawal = async (input: {
  customerId: number;
  amount: number;
  bankAccount: Record<string, unknown>;
}) => {
  const t = await repo.createWithdrawal({
    customerId: input.customerId,
    amount: input.amount,
    bankAccount: input.bankAccount as any,
  });
  return toTransactionDto(t);
};

export const attachProviderRef = (transactionId: number, providerRef: string) =>
  repo.setProviderRef(transactionId, providerRef);

export const refundWithdrawal = async (input: {
  transactionId: number;
  customerId: number;
  amount: number;
  reason: string;
}) => {
  const t = await repo.failWithdrawal({
    id: input.transactionId,
    customerId: input.customerId,
    amount: input.amount,
    reason: input.reason,
  });
  return toTransactionDto(t);
};

// ─── Webhook (payout status flip by provider ref) ────────────────────────────
export const findTransactionByProviderRef = async (providerRef: string) => {
  const t = await repo.findTransactionByProviderRef(providerRef);
  return t ? toTransactionDto(t) : null;
};

export const markPayoutStatus = (
  providerRef: string,
  status: "successful" | "failed",
  reason?: string
) => repo.setStatusByProviderRef(providerRef, status, reason);

/**
 * Webhook handler: flip a PENDING withdrawal by providerRef. On success → mark
 * successful. On failure → refund the customer's points (if DEBIT) + mark failed.
 * Idempotent: returns a status so the controller can ack appropriately.
 */
export const applyPayoutWebhook = async (
  providerRef: string,
  outcome: "successful" | "failed",
  failureReason?: string
): Promise<"unknown" | "already" | "ok"> => {
  const t = await repo.findTransactionByProviderRef(providerRef);
  if (!t) return "unknown";
  if (t.status !== "pending") return "already";

  if (outcome === "successful") {
    await repo.setStatusByProviderRef(providerRef, "successful");
    return "ok";
  }
  // failed/reversed/rejected → refund (DEBIT only) + mark failed, atomic.
  await repo.failWithdrawal({
    id: t.id,
    customerId: t.customerId,
    amount: t.type === "debit" ? t.coin : 0,
    reason: failureReason ?? "Payout failed.",
  });
  return "ok";
};

// ════════════════════════════════════════════════════════════════════════════
// ADMIN referral (branched from src/admin/referral/referral.service.ts)
// ════════════════════════════════════════════════════════════════════════════

export const parseId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const splitNameParts = (full: string | null | undefined) => splitName(full);

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// ─── Programs ────────────────────────────────────────────────────────────────
export const adminListPrograms = async () => (await repo.listPrograms()).map(toProgramDto);

export const adminGetProgram = async (id: number) => {
  const p = await repo.findProgram(id);
  return p ? toProgramDto(p) : null;
};

export const adminProgramNameExists = (name: string, exceptId?: number) =>
  repo.programNameExists(name, exceptId).then(Boolean);

// Map the validated admin body (Mongo-style: referralDiscount/referralReward) → SQL cols.
const toProgramWrite = (v: any) => ({
  ...(v.name !== undefined ? { name: v.name } : {}),
  ...(v.title !== undefined ? { title: v.title } : {}),
  ...(v.image !== undefined ? { image: v.image } : {}),
  ...(v.referralDiscount !== undefined ? { refferalDiscount: v.referralDiscount } : {}),
  ...(v.referralReward !== undefined ? { refferalReward: v.referralReward } : {}),
  ...(v.minimumPrice !== undefined ? { minimumPrice: v.minimumPrice } : {}),
  ...(v.initialRewardAmount !== undefined ? { initialRewardAmount: v.initialRewardAmount } : {}),
  ...(v.video !== undefined ? { video: v.video } : {}),
  ...(v.status !== undefined ? { status: v.status } : {}),
});

export const adminCreateProgram = async (v: any) => {
  const created = await repo.createProgram(toProgramWrite(v) as any);
  return toProgramDto(created);
};

export const adminUpdateProgram = async (id: number, v: any) => {
  const updated = await repo.updateProgram(id, toProgramWrite(v) as any);
  return toProgramDto(updated);
};

export const adminDeleteProgram = (id: number) => repo.deleteProgram(id);

// ─── Transactions ────────────────────────────────────────────────────────────
const toAdminTxnDto = (t: any) => ({
  ...toTransactionDto(t),
  customerId: t.customer
    ? { _id: String(t.customer.id), ...splitNameParts(t.customer.fullName), phoneNumber: t.customer.phoneNumber, emailAddress: t.customer.emailAddress ?? null, referralCode: t.customer.referralCode ?? null }
    : String(t.customerId),
});

export const adminListTransactions = async (q: {
  customerId?: string; type?: string; status?: string; fromDate?: string; toDate?: string; page: number; limit: number;
}) => {
  const opts = {
    customerId: q.customerId ? parseId(q.customerId) ?? undefined : undefined,
    type: (q.type === "credit" || q.type === "debit" ? q.type : undefined) as "credit" | "debit" | undefined,
    status: (["pending", "successful", "failed"].includes(q.status ?? "") ? q.status : undefined) as "pending" | "successful" | "failed" | undefined,
    from: q.fromDate ? new Date(q.fromDate) : undefined,
    to: q.toDate ? new Date(q.toDate) : undefined,
    skip: (q.page - 1) * q.limit,
    take: q.limit,
  };
  const [rows, total] = await Promise.all([repo.adminListTransactions(opts), repo.adminCountTransactions(opts)]);
  return { data: rows.map(toAdminTxnDto), total };
};

export const adminGetTransactionRaw = (id: number) => repo.findTransactionById(id);

export const adminUpdateWithdrawalStatus = async (id: number, status: string, description?: string) => {
  const s = ["pending", "successful", "failed"].includes(status) ? (status as any) : null;
  if (!s) return { ok: false as const, reason: "bad_status" as const };
  const t = await repo.findTransactionById(id);
  if (!t) return { ok: false as const, reason: "not_found" as const };
  if (t.type !== "debit") return { ok: false as const, reason: "not_debit" as const };
  const updated = await repo.updateTransactionStatus(id, s, description);
  return { ok: true as const, data: toTransactionDto(updated) };
};

export const adminRejectWithdrawal = async (id: number) => {
  const t = await repo.findTransactionById(id);
  if (!t) return { ok: false as const, reason: "not_found" as const };
  if (t.type !== "debit") return { ok: false as const, reason: "not_debit" as const };
  if (t.status !== "pending") return { ok: false as const, reason: "not_pending" as const };
  await repo.rejectWithdrawal({ id, customerId: t.customerId, amount: t.coin });
  return { ok: true as const };
};

// ─── Reports + CSV ─────────────────────────────────────────────────────────
const parseReportWindow = (fromDate?: string, toDate?: string) => {
  const from = fromDate ? new Date(fromDate) : undefined;
  let to: Date | undefined;
  if (toDate) { to = new Date(toDate); to.setHours(23, 59, 59, 999); }
  return { from, to };
};

export const adminWithdrawalsReport = async (q: {
  status?: string; fromDate?: string; toDate?: string; search?: string; page: number; limit: number;
}) => {
  const status = ["pending", "successful", "failed"].includes(q.status ?? "") ? q.status : undefined;
  const { from, to } = parseReportWindow(q.fromDate, q.toDate);
  const base = { status, from, to, search: q.search };
  const [rows, total] = await Promise.all([
    repo.withdrawalRows({ ...base, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.withdrawalReportCount(base),
  ]);
  const data = rows.map((r) => ({
    _id: String(r.id),
    date: r.date,
    accountHolderName: r.accountHolderName ?? null,
    ifscCode: r.ifscCode ?? null,
    accountNumber: r.accountNumber ?? null,
    bankName: r.bankName ?? null,
    branchName: r.branchName ?? null,
    coin: num(r.coin),
    status: r.status,
    providerRef: r.providerRef ?? null,
    failureReason: r.failureReason ?? null,
    referralCode: r.referralCode ?? null,
    customerId: r.customerId != null ? String(r.customerId) : null,
    customerName: (r.customerName ?? "").trim() || null,
    customerPhone: r.customerPhone ?? null,
  }));
  return { data, total };
};

export const adminWithdrawalsCsv = async (q: { status?: string; fromDate?: string; toDate?: string }): Promise<string> => {
  const status = ["pending", "successful", "failed"].includes(q.status ?? "") ? q.status : undefined;
  const { from, to } = parseReportWindow(q.fromDate, q.toDate);
  const rows = await repo.withdrawalRows({ status, from, to });
  const esc = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ["Bank Account Holder Name", "Bank Account Number", "IFSC Code", "Amount", "Status", "Date"];
  const lines = [header.join(",")];
  for (const r of rows) {
    lines.push([esc(r.accountHolderName), esc(r.accountNumber), esc(r.ifscCode), esc(num(r.coin)), esc(r.status), esc(r.date ? new Date(r.date).toISOString() : "")].join(","));
  }
  return lines.join("\n");
};

// ─── Manual reward adjustment ────────────────────────────────────────────────
export const adminAdjustRewards = async (
  customerId: number,
  input: { amount: number; type: "credit" | "debit"; description?: string }
) => {
  const customer = await repo.findAdjustCustomer(customerId);
  if (!customer) return { ok: false as const, reason: "not_found" as const };
  if (input.type === "debit" && input.amount > (customer.rewardPoints ?? 0)) {
    return { ok: false as const, reason: "exceeds" as const };
  }
  const signedDelta = input.type === "credit" ? input.amount : -input.amount;
  const txn = await repo.adjustRewards({ customerId, signedDelta, amount: input.amount, type: input.type, description: input.description });
  return { ok: true as const, data: toTransactionDto(txn) };
};

// ─── Referrers rollup ────────────────────────────────────────────────────────
export const adminListReferrers = async (q: {
  search?: string; sort?: string; hasWithdrawn?: string; minEarned?: string; page: number; limit: number;
}) => {
  const minEarnedNum = q.minEarned ? parseInt(q.minEarned, 10) : NaN;
  const rows = await repo.referrerRows({
    search: q.search,
    sort: q.sort ?? "earned",
    hasWithdrawn: q.hasWithdrawn,
    minEarned: Number.isNaN(minEarnedNum) ? undefined : minEarnedNum,
    skip: (q.page - 1) * q.limit,
    take: q.limit,
  });
  const data = rows.map((r) => {
    const name = splitNameParts(r.customerName);
    return {
      customerId: String(r.customerId),
      firstName: name.firstName,
      lastName: name.lastName,
      phoneNumber: r.phoneNumber,
      emailAddress: r.emailAddress ?? null,
      referralCode: r.referralCode,
      referralCodeCreatedAt: r.referralCodeCreatedAt ?? null,
      rewardPoints: num(r.rewardPoints),
      stats: {
        totalEarned: num(r.totalEarned),
        totalWithdrawn: num(r.totalWithdrawn),
        pendingWithdrawals: num(r.pendingWithdrawals),
        failedWithdrawals: num(r.failedWithdrawals),
        successfulWithdrawals: num(r.successfulWithdrawals),
        lastWithdrawalAt: r.lastWithdrawalAt ?? null,
      },
    };
  });
  // total = count of matching referrers (without pagination); approximate via a count query
  return { data };
};

export { toTransactionDto, toProgramDto };
