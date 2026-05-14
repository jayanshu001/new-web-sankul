import { Request, Response } from "express";
import mongoose from "mongoose";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { ReferralTransaction } from "../../models/referral/ReferralTransaction.model";
import { Customer } from "../../models/customer/Customer.model";
import { RefferalTransactionType, RefferalTransactionStatus } from "../../models/enums";
import {
  createProgramSchema,
  updateProgramSchema,
  updateTransactionStatusSchema,
  adjustRewardPointsSchema,
} from "./referral.validation";

// ─── Programs ─────────────────────────────────────────────────────────────────

export const getPrograms = async (_req: Request, res: Response) => {
  try {
    const programs = await ReferralProgram.find().sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: programs });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const getProgramById = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid program id." });
    const program = await ReferralProgram.findById(id);
    if (!program) return res.status(404).json({ success: false, message: "Program not found." });
    return res.status(200).json({ success: true, data: program });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createProgram = async (req: Request, res: Response) => {
  try {
    const data = createProgramSchema.parse(req.body);
    const program = await ReferralProgram.create(data);
    return res.status(201).json({ success: true, data: program });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.code === 11000)
      return res.status(409).json({ success: false, message: "Program name already exists." });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateProgram = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid program id." });
    const data = updateProgramSchema.parse(req.body);
    const program = await ReferralProgram.findByIdAndUpdate(id, { $set: data }, { new: true });
    if (!program) return res.status(404).json({ success: false, message: "Program not found." });
    return res.status(200).json({ success: true, data: program });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteProgram = async (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid program id." });
    const program = await ReferralProgram.findByIdAndDelete(id);
    if (!program) return res.status(404).json({ success: false, message: "Program not found." });
    return res.status(200).json({ success: true, message: "Program deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Transactions ─────────────────────────────────────────────────────────────

export const getTransactions = async (req: Request, res: Response) => {
  try {
    const {
      customerId,
      type,
      status,
      fromDate,
      toDate,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

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
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const [data, total] = await Promise.all([
      ReferralTransaction.find(filter)
        .populate("customerId", "_id firstName lastName phoneNumber emailAddress referralCode")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      ReferralTransaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateWithdrawalStatus = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid transaction id." });

    const { status, description } = updateTransactionStatusSchema.parse(req.body);

    const txn = await ReferralTransaction.findById(id);
    if (!txn) return res.status(404).json({ success: false, message: "Transaction not found." });

    if (txn.type !== RefferalTransactionType.DEBIT) {
      return res.status(400).json({
        success: false,
        message: "Only debit withdrawal transactions can have status updated.",
      });
    }

    const wasPending = txn.status === RefferalTransactionStatus.PENDING;
    const becomingSuccessful = status === RefferalTransactionStatus.SUCCESSFUL;

    let updated: any;
    await session.withTransaction(async () => {
      updated = await ReferralTransaction.findByIdAndUpdate(
        id,
        {
          $set: {
            status,
            ...(description ? { description } : {}),
          },
        },
        { new: true, session }
      );

      // If admin is rejecting/reverting a pending withdrawal, refund the reward points.
      if (wasPending && !becomingSuccessful && status === RefferalTransactionStatus.PENDING) {
        // no-op — still pending
      }
    });

    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

export const rejectWithdrawal = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const id = req.params.id as string;
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid transaction id." });

    const txn = await ReferralTransaction.findById(id);
    if (!txn) return res.status(404).json({ success: false, message: "Transaction not found." });

    if (txn.type !== RefferalTransactionType.DEBIT) {
      return res.status(400).json({ success: false, message: "Only withdrawal debits can be rejected." });
    }
    if (txn.status !== RefferalTransactionStatus.PENDING) {
      return res.status(400).json({
        success: false,
        message: "Only pending withdrawals can be rejected.",
      });
    }

    await session.withTransaction(async () => {
      await Customer.updateOne(
        { _id: txn.customerId },
        { $inc: { rewardPoints: txn.coin } },
        { session }
      );
      await ReferralTransaction.deleteOne({ _id: txn._id }, { session });
    });

    return res.status(200).json({ success: true, message: "Withdrawal rejected and refunded." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Withdrawal CSV Export ────────────────────────────────────────────────────

export const exportWithdrawalsCsv = async (req: Request, res: Response) => {
  try {
    const { fromDate, toDate, status } = req.query as Record<string, string>;
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

    const rows = await ReferralTransaction.find(filter).sort({ createdAt: -1 });

    const csvEscape = (v: any) => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ["Bank Account Holder Name", "Bank Account Number", "IFSC Code", "Amount", "Status", "Date"];
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

    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="WithdrawalRequests.csv"');
    return res.status(200).send(lines.join("\n"));
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Manual Reward Adjustment ─────────────────────────────────────────────────

export const adjustCustomerRewards = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const customerId = req.params.customerId as string;
    if (!mongoose.Types.ObjectId.isValid(customerId))
      return res.status(400).json({ success: false, message: "Invalid customer id." });

    const { amount, type, description } = adjustRewardPointsSchema.parse(req.body);
    const signedDelta = type === "credit" ? amount : -amount;

    const customer = await Customer.findOne({ _id: customerId, isAccountDeleted: false });
    if (!customer) return res.status(404).json({ success: false, message: "Customer not found." });

    if (type === "debit" && amount > (customer.rewardPoints ?? 0)) {
      return res.status(400).json({
        success: false,
        message: "Debit amount exceeds customer's reward points.",
      });
    }

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

    return res.status(201).json({ success: true, data: txn });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Referrers Listing (all customers with a generated referral code) ─────────

export const getReferrers = async (req: Request, res: Response) => {
  try {
    const {
      search,
      sort = "earned",
      hasWithdrawn,
      minEarned,
      page = "1",
      limit = "20",
    } = req.query as Record<string, string>;

    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
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
    if (!Number.isNaN(minEarnedNum)) postLookupMatch["stats.totalEarned"] = { $gte: minEarnedNum };

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

    return res.status(200).json({
      success: true,
      data,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
