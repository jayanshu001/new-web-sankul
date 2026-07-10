import { referralRepository as repo } from "./referral.repository";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import type { Prisma, RefferalProgram, RefferalTransaction } from "@prisma/client";

export const REFERRAL_MODULE = "referral";
export const isReferralMysql = (): boolean => true;

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

// ─── Referral credit on purchase (SQL mirror of credit-referrer.ts) ──────────
// Idempotent on (orderId, referrerId). Mirrors the Mongo creditReferrer: reward
// = program.refferalReward % of paidAmount, skipped when self-referral / no
// program / zero reward. SQL ids are ints.
export const creditReferrerMysql = async (opts: {
  referrerId: number; buyerId: number; orderId: number; paidAmount: number;
  source: "course" | "package" | "ebook" | "liveCourse" | "testSeries";
}): Promise<void> => {
  if (!opts.referrerId || !opts.orderId || opts.paidAmount <= 0) return;
  if (opts.referrerId === opts.buyerId) return;

  const program = await repo.findActiveProgramByName("student");
  const pct = program ? Number(program.refferalReward) || 0 : 0;
  if (pct <= 0) return;

  const coin = Math.round((opts.paidAmount * pct) / 100);
  if (coin <= 0) return;

  // Fast-path idempotency (the atomic write re-checks under the tx).
  if (await repo.findCreditByOrder(opts.orderId, opts.referrerId)) return;
  await repo.creditReferralReward({
    referrerId: opts.referrerId,
    orderId: opts.orderId,
    coin,
    description: `Referral reward (${pct}%) — ${opts.source} purchase`,
  });
};

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
  opts: { type?: string; search?: string; page: number; limit: number }
) => {
  const type = opts.type === "credit" || opts.type === "debit" ? opts.type : undefined;
  const search = opts.search?.trim() || undefined;
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    repo.listTransactions(customerId, { type, search, skip, take: opts.limit }),
    repo.countTransactions(customerId, { type, search }),
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
export const adminListPrograms = async (
  opts: { search?: string; sortBy?: string; sortDir?: "asc" | "desc"; skip?: number; take?: number } = {}
): Promise<{ data: any[]; total: number }> => {
  const where: Prisma.RefferalProgramWhereInput = {};
  if (opts.search?.trim()) {
    const s = opts.search.trim();
    where.OR = [{ name: { contains: s } }, { title: { contains: s } }];
  }
  const dir: "asc" | "desc" = opts.sortDir === "desc" ? "desc" : "asc";
  const orderBy: Prisma.RefferalProgramOrderByWithRelationInput[] =
    opts.sortBy === "name" ? [{ name: dir }, { id: "desc" }] :
    opts.sortBy === "title" ? [{ title: dir }, { id: "desc" }] :
    [{ id: "desc" }];
  const [rows, total] = await Promise.all([
    repo.listPrograms({ where, orderBy, skip: opts.skip, take: opts.take }),
    repo.countPrograms(where),
  ]);
  return { data: rows.map(toProgramDto), total };
};

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
// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to →
// 23:59:59.999 at Asia/Kolkata, +05:30) so the admin's calendar pick includes the
// full IST day (a naive UTC/local parse dropped the last 5.5h). Bounds created_at.
const parseIstDayBound = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
const parseReportWindow = (fromDate?: string, toDate?: string) => ({
  from: parseIstDayBound(fromDate, false),
  to: parseIstDayBound(toDate, true),
});

// IST (Asia/Kolkata, +5:30, no DST) `YYYY-MM-DD HH:mm:ss` — unified with the other
// report exports (was raw UTC ISO).
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtExportDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
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
  const header = ["Bank Account Holder Name", "Bank Account Number", "IFSC Code", "Amount", "Status", "Date"];
  // Low-volume report → a single batch is fine (withdrawalRows is already uncapped).
  async function* rowBatches() {
    yield rows.map((r) => [r.accountHolderName ?? "", r.accountNumber ?? "", r.ifscCode ?? "", num(r.coin), r.status ?? "", fmtExportDate(r.date)]);
  }
  return buildCsvFromRowBatches(header, rowBatches());
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
