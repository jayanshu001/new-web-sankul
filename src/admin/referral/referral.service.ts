// src/admin/referral/referral.service.ts
//
// Domain logic for admin referral endpoints. Withdrawals + reward adjustments
// are financial mutations — the controller layer enforces `Idempotency-Key`
// (see referral.routes.ts); this layer keeps the multi-doc writes inside
// `session.withTransaction()` so retries can't half-apply.

import mongoose from "mongoose";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { ReferralTransaction } from "../../models/referral/ReferralTransaction.model";
import { Customer } from "../../models/customer/Customer.model";
import {
  RefferalTransactionType,
  RefferalTransactionStatus,
} from "../../models/enums";
import { HttpError } from "../../middlewares/errorHandler";

const assertObjectId = (id: string, label: string): void => {
  if (!mongoose.Types.ObjectId.isValid(id)) {
    throw new HttpError(400, `Invalid ${label} id.`);
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Programs (small master)
// ──────────────────────────────────────────────────────────────────────────────

export const listPrograms = async () =>
  ReferralProgram.find().sort({ createdAt: -1 }).lean();

export const getProgramById = async (id: string) => {
  assertObjectId(id, "program");
  const program = await ReferralProgram.findById(id).lean();
  if (!program) throw new HttpError(404, "Program not found.");
  return program;
};

export const createProgram = async (validated: any) => {
  try {
    const program = await ReferralProgram.create(validated);
    return program.toObject();
  } catch (error: any) {
    if (error?.code === 11000) {
      throw new HttpError(409, "Program name already exists.");
    }
    throw error;
  }
};

export const updateProgram = async (id: string, validated: any) => {
  assertObjectId(id, "program");
  const program = await ReferralProgram.findByIdAndUpdate(
    id,
    { $set: validated },
    { new: true }
  ).lean();
  if (!program) throw new HttpError(404, "Program not found.");
  return program;
};

export const deleteProgram = async (id: string) => {
  assertObjectId(id, "program");
  const program = await ReferralProgram.findByIdAndDelete(id).lean();
  if (!program) throw new HttpError(404, "Program not found.");
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

  const filter: any = {};
  if (customerId && mongoose.Types.ObjectId.isValid(customerId)) filter.customerId = customerId;
  if (type === RefferalTransactionType.CREDIT || type === RefferalTransactionType.DEBIT)
    filter.type = type;
  if (
    status === RefferalTransactionStatus.PENDING ||
    status === RefferalTransactionStatus.SUCCESSFUL ||
    status === RefferalTransactionStatus.FAILED
  )
    filter.status = status;
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) filter.createdAt.$lte = new Date(toDate);
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 20, 1), 100);
  const skip = (pageNum - 1) * limitNum;

  const [data, total] = await Promise.all([
    ReferralTransaction.find(filter)
      .populate("customerId", "_id firstName lastName phoneNumber emailAddress referralCode")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum)
      .lean(),
    ReferralTransaction.countDocuments(filter),
  ]);

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

export const updateWithdrawalStatus = async (
  id: string,
  validated: { status: string; description?: string }
) => {
  assertObjectId(id, "transaction");

  const txn = await ReferralTransaction.findById(id);
  if (!txn) throw new HttpError(404, "Transaction not found.");
  if (txn.type !== RefferalTransactionType.DEBIT) {
    throw new HttpError(
      400,
      "Only debit withdrawal transactions can have status updated."
    );
  }

  const session = await mongoose.startSession();
  try {
    let updated: any;
    await session.withTransaction(async () => {
      updated = await ReferralTransaction.findByIdAndUpdate(
        id,
        {
          $set: {
            status: validated.status,
            ...(validated.description ? { description: validated.description } : {}),
          },
        },
        { new: true, session }
      );
    });
    return updated;
  } finally {
    session.endSession();
  }
};

export const rejectWithdrawal = async (id: string) => {
  assertObjectId(id, "transaction");

  const txn = await ReferralTransaction.findById(id);
  if (!txn) throw new HttpError(404, "Transaction not found.");
  if (txn.type !== RefferalTransactionType.DEBIT) {
    throw new HttpError(400, "Only withdrawal debits can be rejected.");
  }
  if (txn.status !== RefferalTransactionStatus.PENDING) {
    throw new HttpError(400, "Only pending withdrawals can be rejected.");
  }

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      await Customer.updateOne(
        { _id: txn.customerId },
        { $inc: { rewardPoints: txn.coin } },
        { session }
      );
      await ReferralTransaction.deleteOne({ _id: txn._id }, { session });
    });
  } finally {
    session.endSession();
  }
};

// ──────────────────────────────────────────────────────────────────────────────
// Withdrawal Report (admin "Referral Report" screen)
// ──────────────────────────────────────────────────────────────────────────────

export interface WithdrawalsReportQuery {
  fromDate?: string;
  toDate?: string;
  status?: string;
  search?: string;
  page?: string;
  limit?: string;
}

export const getWithdrawalsReport = async (query: WithdrawalsReportQuery) => {
  const { fromDate, toDate, status, search, page = "1", limit = "10" } = query;

  const filter: any = { type: RefferalTransactionType.DEBIT, bankAccount: { $ne: null } };
  if (
    status === RefferalTransactionStatus.PENDING ||
    status === RefferalTransactionStatus.SUCCESSFUL ||
    status === RefferalTransactionStatus.FAILED
  )
    filter.status = status;
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) {
      const end = new Date(toDate);
      end.setHours(23, 59, 59, 999);
      filter.createdAt.$lte = end;
    }
  }

  const pageNum = Math.max(parseInt(page, 10) || 1, 1);
  const limitNum = Math.min(Math.max(parseInt(limit, 10) || 10, 1), 200);
  const skip = (pageNum - 1) * limitNum;

  const searchTrimmed = (search ?? "").trim();
  const searchRx = searchTrimmed
    ? new RegExp(searchTrimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    : null;

  const pipeline: any[] = [
    { $match: filter },
    {
      $lookup: {
        from: "ws_customers",
        localField: "customerId",
        foreignField: "_id",
        as: "customer",
      },
    },
    { $unwind: { path: "$customer", preserveNullAndEmptyArrays: true } },
    ...(searchRx
      ? [
          {
            $match: {
              $or: [
                { "bankAccount.accountHolderName": searchRx },
                { "bankAccount.accountNumber": searchRx },
                { "bankAccount.ifscCode": searchRx },
                { "customer.firstName": searchRx },
                { "customer.lastName": searchRx },
                { "customer.phoneNumber": searchRx },
                { "customer.referralCode": searchRx },
              ],
            },
          },
        ]
      : []),
    {
      $facet: {
        data: [
          { $sort: { createdAt: -1 } },
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              _id: 1,
              date: "$createdAt",
              accountHolderName: "$bankAccount.accountHolderName",
              ifscCode: "$bankAccount.ifscCode",
              accountNumber: "$bankAccount.accountNumber",
              bankName: "$bankAccount.bankName",
              branchName: "$bankAccount.branchName",
              coin: 1,
              status: 1,
              providerRef: 1,
              failureReason: 1,
              referralCode: "$customer.referralCode",
              customerId: "$customer._id",
              customerName: {
                $trim: {
                  input: {
                    $concat: [
                      { $ifNull: ["$customer.firstName", ""] },
                      " ",
                      { $ifNull: ["$customer.lastName", ""] },
                    ],
                  },
                },
              },
              customerPhone: "$customer.phoneNumber",
            },
          },
        ],
        totalArr: [{ $count: "total" }],
      },
    },
  ];

  const [result] = await ReferralTransaction.aggregate(pipeline);
  const data = result?.data ?? [];
  const total = result?.totalArr?.[0]?.total ?? 0;

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};

// ──────────────────────────────────────────────────────────────────────────────
// Withdrawal CSV export
// ──────────────────────────────────────────────────────────────────────────────

export interface WithdrawalsCsvQuery {
  fromDate?: string;
  toDate?: string;
  status?: string;
}

export const buildWithdrawalsCsv = async (query: WithdrawalsCsvQuery): Promise<string> => {
  const { fromDate, toDate, status } = query;
  const filter: any = { type: RefferalTransactionType.DEBIT, bankAccount: { $ne: null } };
  if (
    status === RefferalTransactionStatus.PENDING ||
    status === RefferalTransactionStatus.SUCCESSFUL ||
    status === RefferalTransactionStatus.FAILED
  )
    filter.status = status;
  if (fromDate || toDate) {
    filter.createdAt = {};
    if (fromDate) filter.createdAt.$gte = new Date(fromDate);
    if (toDate) filter.createdAt.$lte = new Date(toDate);
  }

  const rows = await ReferralTransaction.find(filter).sort({ createdAt: -1 }).lean();

  const csvEscape = (v: any) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const header = [
    "Bank Account Holder Name",
    "Bank Account Number",
    "IFSC Code",
    "Amount",
    "Status",
    "Date",
  ];
  const lines = [header.join(",")];
  for (const r of rows) {
    const ba: any = r.bankAccount || {};
    lines.push(
      [
        csvEscape(ba.accountHolderName),
        csvEscape(ba.accountNumber),
        csvEscape(ba.ifscCode),
        csvEscape(r.coin),
        csvEscape(r.status),
        csvEscape(r.createdAt?.toISOString()),
      ].join(",")
    );
  }
  return lines.join("\n");
};

// ──────────────────────────────────────────────────────────────────────────────
// Manual reward adjustment
// ──────────────────────────────────────────────────────────────────────────────

export const adjustCustomerRewards = async (
  customerId: string,
  input: { amount: number; type: "credit" | "debit"; description?: string }
) => {
  assertObjectId(customerId, "customer");
  const { amount, type, description } = input;
  const signedDelta = type === "credit" ? amount : -amount;

  const customer = await Customer.findOne({
    _id: customerId,
    isAccountDeleted: false,
  });
  if (!customer) throw new HttpError(404, "Customer not found.");

  if (type === "debit" && amount > (customer.rewardPoints ?? 0)) {
    throw new HttpError(400, "Debit amount exceeds customer's reward points.");
  }

  const session = await mongoose.startSession();
  try {
    let txn: any;
    await session.withTransaction(async () => {
      await Customer.updateOne(
        { _id: customerId },
        { $inc: { rewardPoints: signedDelta } },
        { session }
      );
      const [created] = await ReferralTransaction.create(
        [
          {
            customerId,
            description,
            coin: amount,
            type:
              type === "credit"
                ? RefferalTransactionType.CREDIT
                : RefferalTransactionType.DEBIT,
            status: RefferalTransactionStatus.SUCCESSFUL,
          },
        ],
        { session }
      );
      txn = created;
    });
    return txn;
  } finally {
    session.endSession();
  }
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
  const skip = (pageNum - 1) * limitNum;

  const match: Record<string, unknown> = {
    referralCode: { $exists: true, $ne: null },
    isAccountDeleted: false,
  };
  if (search) {
    const rx = new RegExp(search.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
    match.$or = [
      { referralCode: rx },
      { firstName: rx },
      { lastName: rx },
      { phoneNumber: rx },
      { emailAddress: rx },
    ];
  }

  const sortStage: Record<string, 1 | -1> = ((): Record<string, 1 | -1> => {
    switch (sort) {
      case "withdrawn":
        return { "stats.totalWithdrawn": -1 };
      case "balance":
        return { rewardPoints: -1 };
      case "createdAt":
        return { createdAt: -1 };
      case "earned":
      default:
        return { "stats.totalEarned": -1 };
    }
  })();

  const postLookupMatch: Record<string, unknown> = {};
  if (hasWithdrawn === "true") postLookupMatch["stats.totalWithdrawn"] = { $gt: 0 };
  if (hasWithdrawn === "false") postLookupMatch["stats.totalWithdrawn"] = { $eq: 0 };
  const minEarnedNum = minEarned ? parseInt(minEarned, 10) : NaN;
  if (!Number.isNaN(minEarnedNum))
    postLookupMatch["stats.totalEarned"] = { $gte: minEarnedNum };

  const pipeline: any[] = [
    { $match: match },
    {
      $lookup: {
        from: "ws_referral_transactions",
        let: { cid: "$_id" },
        pipeline: [
          { $match: { $expr: { $eq: ["$customerId", "$$cid"] } } },
          {
            $group: {
              _id: { type: "$type", status: "$status" },
              amount: { $sum: "$coin" },
              count: { $sum: 1 },
              lastAt: { $max: "$createdAt" },
            },
          },
        ],
        as: "_txnAgg",
      },
    },
    {
      $addFields: {
        stats: {
          totalEarned: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$_txnAgg",
                    as: "t",
                    cond: { $eq: ["$$t._id.type", RefferalTransactionType.CREDIT] },
                  },
                },
                as: "t",
                in: "$$t.amount",
              },
            },
          },
          totalWithdrawn: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$_txnAgg",
                    as: "t",
                    cond: {
                      $and: [
                        { $eq: ["$$t._id.type", RefferalTransactionType.DEBIT] },
                        { $eq: ["$$t._id.status", RefferalTransactionStatus.SUCCESSFUL] },
                      ],
                    },
                  },
                },
                as: "t",
                in: "$$t.amount",
              },
            },
          },
          pendingWithdrawals: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$_txnAgg",
                    as: "t",
                    cond: {
                      $and: [
                        { $eq: ["$$t._id.type", RefferalTransactionType.DEBIT] },
                        { $eq: ["$$t._id.status", RefferalTransactionStatus.PENDING] },
                      ],
                    },
                  },
                },
                as: "t",
                in: "$$t.count",
              },
            },
          },
          failedWithdrawals: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$_txnAgg",
                    as: "t",
                    cond: {
                      $and: [
                        { $eq: ["$$t._id.type", RefferalTransactionType.DEBIT] },
                        { $eq: ["$$t._id.status", RefferalTransactionStatus.FAILED] },
                      ],
                    },
                  },
                },
                as: "t",
                in: "$$t.count",
              },
            },
          },
          successfulWithdrawals: {
            $sum: {
              $map: {
                input: {
                  $filter: {
                    input: "$_txnAgg",
                    as: "t",
                    cond: {
                      $and: [
                        { $eq: ["$$t._id.type", RefferalTransactionType.DEBIT] },
                        { $eq: ["$$t._id.status", RefferalTransactionStatus.SUCCESSFUL] },
                      ],
                    },
                  },
                },
                as: "t",
                in: "$$t.count",
              },
            },
          },
          lastWithdrawalAt: {
            $max: {
              $map: {
                input: {
                  $filter: {
                    input: "$_txnAgg",
                    as: "t",
                    cond: { $eq: ["$$t._id.type", RefferalTransactionType.DEBIT] },
                  },
                },
                as: "t",
                in: "$$t.lastAt",
              },
            },
          },
        },
      },
    },
    { $project: { _txnAgg: 0 } },
    ...(Object.keys(postLookupMatch).length ? [{ $match: postLookupMatch }] : []),
    {
      $facet: {
        data: [
          { $sort: sortStage },
          { $skip: skip },
          { $limit: limitNum },
          {
            $project: {
              _id: 0,
              customerId: "$_id",
              firstName: 1,
              lastName: 1,
              phoneNumber: 1,
              emailAddress: 1,
              referralCode: 1,
              referralCodeCreatedAt: "$createdAt",
              rewardPoints: { $ifNull: ["$rewardPoints", 0] },
              stats: 1,
            },
          },
        ],
        totalArr: [{ $count: "total" }],
      },
    },
  ];

  const [result] = await Customer.aggregate(pipeline);
  const data = result?.data ?? [];
  const total = result?.totalArr?.[0]?.total ?? 0;

  return {
    data,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum),
    },
  };
};
