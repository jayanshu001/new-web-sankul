import { Request, Response } from "express";
import mongoose from "mongoose";
import { Customer } from "../../models/customer/Customer.model";
import { CustomerBankAccount } from "../../models/customer/CustomerBankAccount.model";
import { ReferralProgram } from "../../models/referral/ReferralProgram.model";
import { ReferralTransaction } from "../../models/referral/ReferralTransaction.model";
import { RefferalTransactionType, RefferalTransactionStatus } from "../../models/enums";
import {
  generateReferralCodeSchema,
  withdrawRewardsSchema,
  createBankAccountSchema,
  updateBankAccountSchema,
  BLACKLISTED_REFERRAL_WORDS,
} from "./referral.validation";

const MIN_WITHDRAWAL_AMOUNT = 500;

// ─── Rewards Screen ───────────────────────────────────────────────────────────

export const getRewardsOverview = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const customer = await Customer.findOne({
      _id: customerId,
      isAccountDeleted: false,
      status: true,
    }).select("_id firstName middleName lastName phoneNumber referralCode rewardPoints");

    if (!customer) return res.status(404).json({ success: false, message: "Invalid user." });

    const program = await ReferralProgram.find({ name: "student", status: true });

    return res.status(200).json({
      success: true,
      data: {
        customer: {
          id: customer._id,
          firstName: customer.firstName ?? "",
          middleName: customer.middleName ?? "",
          lastName: customer.lastName ?? "",
          phoneNumber: customer.phoneNumber,
          referralCode: customer.referralCode ?? null,
          rewardPoints: customer.rewardPoints ?? 0,
        },
        program,
      },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Transactions List ────────────────────────────────────────────────────────

export const getMyTransactions = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { page = "1", limit = "20", type } = req.query as Record<string, string>;
    const pageNum = Math.max(parseInt(page, 10) || 1, 1);
    const limitNum = Math.max(parseInt(limit, 10) || 20, 1);
    const skip = (pageNum - 1) * limitNum;

    const filter: any = { customerId };
    if (type === RefferalTransactionType.CREDIT || type === RefferalTransactionType.DEBIT) {
      filter.type = type;
    }

    const [transactions, total] = await Promise.all([
      ReferralTransaction.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limitNum),
      ReferralTransaction.countDocuments(filter),
    ]);

    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Withdrawal Request ───────────────────────────────────────────────────────

export const requestWithdrawal = async (req: Request, res: Response) => {
  const session = await mongoose.startSession();
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { bankAccountId, amount } = withdrawRewardsSchema.parse(req.body);

    if (amount < MIN_WITHDRAWAL_AMOUNT) {
      return res.status(400).json({
        success: false,
        message: `Your withdrawal request must be greater than or equal to ₹${MIN_WITHDRAWAL_AMOUNT}.`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(bankAccountId)) {
      return res.status(400).json({ success: false, message: "Invalid bank account id." });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      isAccountDeleted: false,
      status: true,
    }).select("_id rewardPoints");

    if (!customer) return res.status(404).json({ success: false, message: "Invalid user." });

    if (amount > (customer.rewardPoints ?? 0)) {
      return res.status(400).json({
        success: false,
        message: "Your withdrawal request must be less than or equal to your reward points.",
      });
    }

    const bankAccount = await CustomerBankAccount.findOne({ _id: bankAccountId, customerId });
    if (!bankAccount) {
      return res.status(404).json({ success: false, message: "Bank account not found." });
    }

    let transaction: any;
    await session.withTransaction(async () => {
      await Customer.updateOne(
        { _id: customerId },
        { $inc: { rewardPoints: -amount } },
        { session }
      );

      const [created] = await ReferralTransaction.create(
        [
          {
            customerId,
            bankAccount: bankAccount.toObject(),
            description: "You have requested for bank transfer.",
            coin: amount,
            type: RefferalTransactionType.DEBIT,
            status: RefferalTransactionStatus.PENDING,
          },
        ],
        { session }
      );
      transaction = created;
    });

    return res.status(201).json({ success: true, data: transaction });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Generate Referral Code ───────────────────────────────────────────────────

export const generateReferralCode = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const { referralCode } = generateReferralCodeSchema.parse(req.body);
    const code = referralCode.toUpperCase();

    const customer = await Customer.findOne({
      _id: customerId,
      isAccountDeleted: false,
      status: true,
    }).select("_id referralCode");

    if (!customer) return res.status(404).json({ success: false, message: "Invalid user." });

    if (customer.referralCode) {
      return res.status(400).json({
        success: false,
        message: "You can't generate referral code again.",
      });
    }

    const blacklistHit = BLACKLISTED_REFERRAL_WORDS.some((word) => code.includes(word));
    if (blacklistHit) {
      return res.status(400).json({
        success: false,
        message: "Referral code is not available, please try another one.",
      });
    }

    const exists = await Customer.exists({ referralCode: code });
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Referral code is not available, please try another one.",
      });
    }

    const updated = await Customer.findByIdAndUpdate(
      customerId,
      { $set: { referralCode: code, rewardPoints: 0 } },
      { new: true }
    ).select("_id firstName lastName phoneNumber referralCode rewardPoints");

    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Referral code is not available, please try another one.",
      });
    }
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Bank Accounts (for withdrawal payouts) ───────────────────────────────────

export const listBankAccounts = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });
    const accounts = await CustomerBankAccount.find({ customerId }).sort({ createdAt: -1 });
    return res.status(200).json({ success: true, data: accounts });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createBankAccount = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });

    const data = createBankAccountSchema.parse(req.body);
    const account = await CustomerBankAccount.create({ ...data, customerId });
    return res.status(201).json({ success: true, data: account });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBankAccount = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const id = req.params.id as string;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bank account id." });

    const data = updateBankAccountSchema.parse(req.body);
    const account = await CustomerBankAccount.findOneAndUpdate(
      { _id: id, customerId },
      { $set: data },
      { new: true }
    );
    if (!account) return res.status(404).json({ success: false, message: "Bank account not found." });
    return res.status(200).json({ success: true, data: account });
  } catch (error: any) {
    if (error.issues) return res.status(400).json({ success: false, errors: error.issues });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBankAccount = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    const id = req.params.id as string;
    if (!customerId) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!mongoose.Types.ObjectId.isValid(id))
      return res.status(400).json({ success: false, message: "Invalid bank account id." });

    const account = await CustomerBankAccount.findOneAndDelete({ _id: id, customerId });
    if (!account) return res.status(404).json({ success: false, message: "Bank account not found." });
    return res.status(200).json({ success: true, message: "Bank account deleted." });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
};
