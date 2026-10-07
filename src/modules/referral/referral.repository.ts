// Referral: Prisma queries for programs, transactions, wallet and reports.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildLikeTokens, buildPrismaSearch } from "../../utils/searchFilter";
import { RefferalTransactionStatus } from "../../shared/enums";

/** The balance moved between the controller's pre-check and the transaction; mapped to the same 400. */
export class InsufficientRewardPoints extends Error {
  constructor() {
    super("Insufficient reward points.");
    this.name = "InsufficientRewardPoints";
  }
}

export const referralRepository = {
  findActiveProgramByName: (name: string) =>
    prisma.refferalProgram.findFirst({ where: { name, status: true } }),

  listActiveProgramsByName: (name: string) =>
    prisma.refferalProgram.findMany({ where: { name, status: true } }),

  findRewardCustomer: (id: number) =>
    prisma.customer.findFirst({
      where: { id, isAccountDeleted: false, status: true },
      select: {
        id: true, fullName: true, phoneNumber: true,
        referralCode: true, rewardPoints: true,
      },
    }),

  referralCodeTaken: (code: string) =>
    prisma.customer.findFirst({ where: { referralCode: code }, select: { id: true } }),

  setReferralCode: (id: number, code: string) =>
    prisma.customer.update({
      where: { id },
      data: { referralCode: code, rewardPoints: 0, updatedAt: new Date() },
    }),

  // `rejected` rows are admin/finance-only and hidden from the customer's ledger (the
  // app has no branch for that status). `status` is NOT NULL, so Prisma's `not` is
  // safe here (on a nullable column it would also drop NULL rows).
  // Must stay shared by list, count and findTransaction, or pagination.total drifts
  // and a direct id lookup leaks a hidden row.
  clientVisible: { status: { not: RefferalTransactionStatus.REJECTED } } as const,

  listTransactions: (customerId: number, opts: { type?: "credit" | "debit"; search?: string; skip: number; take: number }) =>
    prisma.refferalTransaction.findMany({
      where: { customerId, ...referralRepository.clientVisible, ...(opts.type ? { type: opts.type } : {}), ...(buildPrismaSearch(opts.search, ["description"]) ?? {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  countTransactions: (customerId: number, opts: { type?: "credit" | "debit"; search?: string }) =>
    prisma.refferalTransaction.count({
      where: { customerId, ...referralRepository.clientVisible, ...(opts.type ? { type: opts.type } : {}), ...(buildPrismaSearch(opts.search, ["description"]) ?? {}) },
    }),

  findTransaction: (id: number, customerId: number) =>
    prisma.refferalTransaction.findFirst({ where: { id, customerId, ...referralRepository.clientVisible } }),

  findTransactionByReferenceNumber: (referenceNumber: string) =>
    prisma.refferalTransaction.findFirst({ where: { referenceNumber } }),

  createWithdrawal: (input: {
    customerId: number;
    amount: number;
    bankAccount: Prisma.InputJsonValue;
  }) =>
    prisma.$transaction(async (tx) => {
      // Conditional debit: the balance is re-checked in the same statement that
      // decrements it, so two concurrent requests can't both pass. Payouts are manual,
      // so nothing downstream would catch a duplicate.
      const debited = await tx.customer.updateMany({
        where: { id: input.customerId, rewardPoints: { gte: input.amount } },
        data: { rewardPoints: { decrement: input.amount } },
      });
      if (debited.count === 0) throw new InsufficientRewardPoints();
      return tx.refferalTransaction.create({
        data: {
          customerId: input.customerId,
          bankAccount: input.bankAccount,
          description: "You have requested for bank transfer.",
          coin: input.amount,
          type: "debit",
          status: "pending",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }),

  setReferenceNumber: (id: number, referenceNumber: string) =>
    prisma.refferalTransaction.update({
      where: { id },
      data: { referenceNumber, updatedAt: new Date() },
    }),

  /** Refund on payout failure (atomic). */
  failWithdrawal: (input: { id: number; customerId: number; amount: number; reason: string }) =>
    prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: input.customerId },
        data: { rewardPoints: { increment: input.amount } },
      });
      return tx.refferalTransaction.update({
        where: { id: input.id },
        data: { status: "failed", failureReason: input.reason.slice(0, 500), updatedAt: new Date() },
      });
    }),

  setStatusByReferenceNumber: (referenceNumber: string, status: "successful" | "failed", reason?: string) =>
    prisma.refferalTransaction.updateMany({
      where: { referenceNumber },
      data: { status, ...(reason ? { failureReason: reason.slice(0, 500) } : {}), updatedAt: new Date() },
    }),

  listPrograms: (opts: { where?: Prisma.RefferalProgramWhereInput; orderBy?: Prisma.RefferalProgramOrderByWithRelationInput[]; skip?: number; take?: number } = {}) =>
    prisma.refferalProgram.findMany({
      where: opts.where,
      orderBy: opts.orderBy ?? [{ id: "desc" }],
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    }),
  countPrograms: (where?: Prisma.RefferalProgramWhereInput) => prisma.refferalProgram.count({ where }),
  findProgram: (id: number) => prisma.refferalProgram.findUnique({ where: { id } }),
  programNameExists: (name: string, exceptId?: number) =>
    prisma.refferalProgram.findFirst({
      where: { name, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    }),
  createProgram: (data: Prisma.RefferalProgramUncheckedCreateInput) =>
    prisma.refferalProgram.create({ data }),
  updateProgram: (id: number, data: Prisma.RefferalProgramUncheckedUpdateInput) =>
    prisma.refferalProgram.update({ where: { id }, data }),
  deleteProgram: (id: number) => prisma.refferalProgram.delete({ where: { id } }),

  adminListTransactions: (opts: {
    customerId?: number; type?: "credit" | "debit"; status?: "pending" | "successful" | "failed" | "rejected";
    from?: Date; to?: Date; skip: number; take: number;
  }) => {
    const where: Prisma.RefferalTransactionWhereInput = {};
    if (opts.customerId !== undefined) where.customerId = opts.customerId;
    if (opts.type) where.type = opts.type;
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) (where.createdAt as any).gte = opts.from;
      if (opts.to) (where.createdAt as any).lte = opts.to;
    }
    return prisma.refferalTransaction.findMany({
      where,
      include: { customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true, referralCode: true } } },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    });
  },
  adminCountTransactions: (opts: {
    customerId?: number; type?: "credit" | "debit"; status?: "pending" | "successful" | "failed" | "rejected"; from?: Date; to?: Date;
  }) => {
    const where: Prisma.RefferalTransactionWhereInput = {};
    if (opts.customerId !== undefined) where.customerId = opts.customerId;
    if (opts.type) where.type = opts.type;
    if (opts.status) where.status = opts.status;
    if (opts.from || opts.to) {
      where.createdAt = {};
      if (opts.from) (where.createdAt as any).gte = opts.from;
      if (opts.to) (where.createdAt as any).lte = opts.to;
    }
    return prisma.refferalTransaction.count({ where });
  },

  findTransactionById: (id: number) => prisma.refferalTransaction.findUnique({ where: { id } }),

  /**
   * Deliberately does not touch `description`: it is the customer's ledger text on
   * /client/referral/transactions/:id and must not carry admin free text.
   */
  updateTransactionStatus: (
    id: number,
    status: "pending" | "successful" | "failed",
    referenceNumber?: string
  ) =>
    prisma.refferalTransaction.update({
      where: { id },
      data: {
        status,
        ...(referenceNumber ? { referenceNumber: referenceNumber.slice(0, 255) } : {}),
        updatedAt: new Date(),
      },
    }),

  /**
   * Refund points and mark the row rejected (kept, not deleted, so the ledger and
   * finance report can explain it). One transaction: a partial apply would refund
   * the coins while leaving the row payable.
   */
  rejectWithdrawal: (input: { id: number; customerId: number; amount: number; reason?: string }) =>
    prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: input.customerId }, data: { rewardPoints: { increment: input.amount } } });
      await tx.refferalTransaction.update({
        where: { id: input.id },
        data: {
          status: "rejected",
          ...(input.reason ? { failureReason: input.reason.slice(0, 500) } : {}),
          updatedAt: new Date(),
        },
      });
    }),

  /** Manual admin adjustment (atomic). */
  adjustRewards: (input: { customerId: number; signedDelta: number; amount: number; type: "credit" | "debit"; description?: string }) =>
    prisma.$transaction(async (tx) => {
      await tx.customer.update({ where: { id: input.customerId }, data: { rewardPoints: { increment: input.signedDelta } } });
      return tx.refferalTransaction.create({
        data: {
          customerId: input.customerId,
          description: input.description ?? "",
          coin: input.amount,
          type: input.type,
          status: "successful",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }),

  findAdjustCustomer: (id: number) =>
    prisma.customer.findFirst({ where: { id, isAccountDeleted: false }, select: { id: true, rewardPoints: true } }),

  /**
   * Idempotency key. `source` disambiguates order ids that collide across the
   * per-type order tables.
   */
  findCreditByOrder: (source: string, orderId: number, customerId: number) =>
    prisma.refferalTransaction.findFirst({ where: { source, orderId, customerId, type: "credit" }, select: { id: true } }),

  /**
   * Re-checks the idempotency key inside the tx so a retried verify/webhook is a
   * no-op. Returns false when already credited.
   */
  creditReferralReward: (input: { referrerId: number; source: string; orderId: number; coin: number; description: string }) =>
    prisma.$transaction(async (tx) => {
      const dup = await tx.refferalTransaction.findFirst({
        where: { source: input.source, orderId: input.orderId, customerId: input.referrerId, type: "credit" },
        select: { id: true },
      });
      if (dup) return false;
      await tx.customer.update({ where: { id: input.referrerId }, data: { rewardPoints: { increment: input.coin } } });
      await tx.refferalTransaction.create({
        data: {
          orderId: input.orderId,
          source: input.source,
          customerId: input.referrerId,
          description: input.description.slice(0, 150),
          coin: input.coin,
          type: "credit",
          status: "successful",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return true;
    }),

  /**
   * Source-tagged DEBIT with no bank_account (not a withdrawal). Idempotent on
   * (source, order, customer, debit). Deducts min(coin, balance) so a balance that
   * dropped since create-order never blocks fulfillment. Returns the coins deducted.
   */
  debitWalletForOrder: (input: { customerId: number; source: string; orderId: number; coin: number; description: string }) =>
    prisma.$transaction(async (tx) => {
      const dup = await tx.refferalTransaction.findFirst({
        where: { source: input.source, orderId: input.orderId, customerId: input.customerId, type: "debit" },
        select: { id: true },
      });
      if (dup) return 0;
      const cust = await tx.customer.findUnique({ where: { id: input.customerId }, select: { rewardPoints: true } });
      const deduct = Math.max(0, Math.min(input.coin, cust?.rewardPoints ?? 0));
      if (deduct <= 0) return 0;
      await tx.customer.update({ where: { id: input.customerId }, data: { rewardPoints: { decrement: deduct } } });
      await tx.refferalTransaction.create({
        data: {
          orderId: input.orderId,
          source: input.source,
          customerId: input.customerId,
          description: input.description.slice(0, 150),
          coin: deduct,
          type: "debit",
          status: "successful",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return deduct;
    }),

  /** Withdrawals = DEBIT rows with bank_account; search spans the bank JSON + customer. */
  withdrawalRows: (opts: { status?: string; from?: Date; to?: Date; search?: string; skip?: number; take?: number }) => {
    const conds: string[] = ["t.type='debit'", "t.bank_account IS NOT NULL"];
    const params: any[] = [];
    if (opts.status) { conds.push("t.status = ?"); params.push(opts.status); }
    if (opts.from) { conds.push("t.created_at >= ?"); params.push(opts.from); }
    if (opts.to) { conds.push("t.created_at <= ?"); params.push(opts.to); }
    if (opts.search) {
      const s = buildLikeTokens(opts.search, [
        "JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.accountHolderName'))",
        "JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.accountNumber'))",
        "JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.ifscCode'))",
        "c.full_name",
        "c.phone",
        "c.referral_code",
      ]);
      if (s) { conds.push(s.sql); params.push(...s.params); }
    }
    const where = conds.join(" AND ");
    const limit = opts.take !== undefined ? ` LIMIT ? OFFSET ?` : "";
    if (opts.take !== undefined) params.push(opts.take, opts.skip ?? 0);
    return prisma.$queryRawUnsafe<any[]>(
      `SELECT t.id, t.created_at AS date, t.coin, t.status, t.reference_number AS referenceNumber, t.failure_reason AS failureReason,
              JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.accountHolderName')) AS accountHolderName,
              JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.ifscCode')) AS ifscCode,
              JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.accountNumber')) AS accountNumber,
              JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.bankName')) AS bankName,
              JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.branchName')) AS branchName,
              c.id AS customerId, c.full_name AS customerName, c.phone AS customerPhone, c.referral_code AS referralCode
       FROM ws_refferal_transaction t
       LEFT JOIN ws_customer c ON c.id = t.customer_id
       WHERE ${where}
       ORDER BY t.created_at DESC, t.id DESC${limit}`,
      ...params
    );
  },
  withdrawalReportCount: async (opts: { status?: string; from?: Date; to?: Date; search?: string }) => {
    const conds: string[] = ["t.type='debit'", "t.bank_account IS NOT NULL"];
    const params: any[] = [];
    if (opts.status) { conds.push("t.status = ?"); params.push(opts.status); }
    if (opts.from) { conds.push("t.created_at >= ?"); params.push(opts.from); }
    if (opts.to) { conds.push("t.created_at <= ?"); params.push(opts.to); }
    if (opts.search) {
      const s = buildLikeTokens(opts.search, [
        "JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.accountHolderName'))",
        "JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.accountNumber'))",
        "JSON_UNQUOTE(JSON_EXTRACT(t.bank_account,'$.ifscCode'))",
        "c.full_name",
        "c.phone",
        "c.referral_code",
      ]);
      if (s) { conds.push(s.sql); params.push(...s.params); }
    }
    const rows = await prisma.$queryRawUnsafe<any[]>(
      `SELECT COUNT(*) AS n FROM ws_refferal_transaction t LEFT JOIN ws_customer c ON c.id=t.customer_id WHERE ${conds.join(" AND ")}`,
      ...params
    );
    return Number(rows[0]?.n ?? 0);
  },

  referrerRows: (opts: { search?: string; sort: string; hasWithdrawn?: string; minEarned?: number; skip: number; take: number }) => {
    const conds: string[] = ["c.referral_code IS NOT NULL", "c.is_account_deleted = 0"];
    const params: any[] = [];
    if (opts.search) {
      const s = buildLikeTokens(opts.search, ["c.referral_code", "c.full_name", "c.phone", "c.email_address"]);
      if (s) { conds.push(s.sql); params.push(...s.params); }
    }
    const having: string[] = [];
    if (opts.hasWithdrawn === "true") having.push("totalWithdrawn > 0");
    if (opts.hasWithdrawn === "false") having.push("totalWithdrawn = 0");
    if (opts.minEarned !== undefined) { having.push("totalEarned >= ?"); }
    const orderBy = opts.sort === "withdrawn" ? "totalWithdrawn DESC"
      : opts.sort === "balance" ? "rewardPoints DESC"
      : opts.sort === "createdAt" ? "c.created_at DESC"
      : "totalEarned DESC";
    const havingSql = having.length ? `HAVING ${having.join(" AND ")}` : "";
    const sql =
      `SELECT c.id AS customerId, c.full_name AS customerName, c.phone AS phoneNumber, c.email_address AS emailAddress,
              c.referral_code AS referralCode, c.created_at AS referralCodeCreatedAt, COALESCE(c.reward_points,0) AS rewardPoints,
              -- Withdrawal aggregates count bank withdrawals ONLY. Wallet-spend
              -- debits (redeeming coins at checkout) carry a non-null source col;
              -- exclude them here so they do not inflate withdrawn stats.
              COALESCE(SUM(CASE WHEN t.type='credit' THEN t.coin ELSE 0 END),0) AS totalEarned,
              COALESCE(SUM(CASE WHEN t.type='debit' AND t.source IS NULL AND t.status='successful' THEN t.coin ELSE 0 END),0) AS totalWithdrawn,
              COALESCE(SUM(CASE WHEN t.type='debit' AND t.source IS NULL AND t.status='pending' THEN 1 ELSE 0 END),0) AS pendingWithdrawals,
              COALESCE(SUM(CASE WHEN t.type='debit' AND t.source IS NULL AND t.status='failed' THEN 1 ELSE 0 END),0) AS failedWithdrawals,
              COALESCE(SUM(CASE WHEN t.type='debit' AND t.source IS NULL AND t.status='successful' THEN 1 ELSE 0 END),0) AS successfulWithdrawals,
              MAX(CASE WHEN t.type='debit' AND t.source IS NULL THEN t.created_at END) AS lastWithdrawalAt
       FROM ws_customer c
       LEFT JOIN ws_refferal_transaction t ON t.customer_id = c.id
       WHERE ${conds.join(" AND ")}
       GROUP BY c.id ${havingSql}
       ORDER BY ${orderBy} LIMIT ? OFFSET ?`;
    if (opts.minEarned !== undefined) params.push(opts.minEarned);
    params.push(opts.take, opts.skip);
    return prisma.$queryRawUnsafe<any[]>(sql, ...params);
  },
};
