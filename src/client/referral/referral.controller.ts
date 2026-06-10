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
import { lookupIfsc } from "./ifsc";
import { createContact, createFundAccount, createPayout } from "../payment/razorpayx";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import {
  isBankAccountMysql,
  parseBankAccountId,
  listBankAccounts as svcListBankAccounts,
  getBankAccount as svcGetBankAccount,
  createBankAccount as svcCreateBankAccount,
  updateBankAccount as svcUpdateBankAccount,
  deleteBankAccount as svcDeleteBankAccount,
} from "../../modules/customer-bank-account/customer-bank-account.service";

const MIN_WITHDRAWAL_AMOUNT = 500;

// ─── Rewards Screen ───────────────────────────────────────────────────────────

export const getRewardsOverview = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getRewardsOverview invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("getRewardsOverview unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    const customer = await Customer.findOne({
      _id: customerId,
      isAccountDeleted: false,
      status: true,
    }).select("_id firstName middleName lastName phoneNumber referralCode rewardPoints");

    if (!customer) { logger.warn("getRewardsOverview customer not found", { traceId, customerId }); return res.status(404).json({ success: false, message: "Invalid user." }); }

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
    logger.error("getRewardsOverview failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Transactions List ────────────────────────────────────────────────────────

export const getMyTransactions = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getMyTransactions invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("getMyTransactions unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

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

    logger.info("getMyTransactions success", { traceId, customerId, total });
    return res.status(200).json({
      success: true,
      data: transactions,
      pagination: { total, page: pageNum, limit: limitNum, totalPages: Math.ceil(total / limitNum) },
    });
  } catch (error: any) {
    logger.error("getMyTransactions failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Transaction Detail ───────────────────────────────────────────────────────

export const getTransactionById = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("getTransactionById invoked", { traceId, path: req.originalUrl, customerId, transactionId: id });

  try {
    if (!customerId) { logger.warn("getTransactionById unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    if (!mongoose.Types.ObjectId.isValid(id)) {
      logger.warn("getTransactionById invalid id", { traceId, customerId, transactionId: id });
      return res.status(400).json({ success: false, message: "Invalid transaction id." });
    }

    const transaction = await ReferralTransaction.findOne({ _id: id, customerId });
    if (!transaction) {
      logger.warn("getTransactionById not found", { traceId, customerId, transactionId: id });
      return res.status(404).json({ success: false, message: "Transaction not found." });
    }

    logger.info("getTransactionById success", { traceId, customerId, transactionId: id });
    return res.status(200).json({ success: true, data: transaction });
  } catch (error: any) {
    logger.error("getTransactionById failed", { traceId, customerId, transactionId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Withdrawal Request ───────────────────────────────────────────────────────

export const requestWithdrawal = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("requestWithdrawal invoked", { traceId, path: req.originalUrl, customerId });

  const session = await mongoose.startSession();
  try {
    if (!customerId) { logger.warn("requestWithdrawal unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    const { bankAccountId, amount } = withdrawRewardsSchema.parse(req.body);

    if (amount < MIN_WITHDRAWAL_AMOUNT) {
      logger.warn("requestWithdrawal below minimum", { traceId, customerId, amount });
      return res.status(400).json({
        success: false,
        message: `Your withdrawal request must be greater than or equal to ₹${MIN_WITHDRAWAL_AMOUNT}.`,
      });
    }

    if (!mongoose.Types.ObjectId.isValid(bankAccountId)) {
      logger.warn("requestWithdrawal invalid bank account id", { traceId, customerId, bankAccountId });
      return res.status(400).json({ success: false, message: "Invalid bank account id." });
    }

    const customer = await Customer.findOne({
      _id: customerId,
      isAccountDeleted: false,
      status: true,
    }).select("_id rewardPoints");

    if (!customer) { logger.warn("requestWithdrawal customer not found", { traceId, customerId }); return res.status(404).json({ success: false, message: "Invalid user." }); }

    if (amount > (customer.rewardPoints ?? 0)) {
      logger.warn("requestWithdrawal insufficient points", { traceId, customerId, amount, available: customer.rewardPoints });
      return res.status(400).json({
        success: false,
        message: "Your withdrawal request must be less than or equal to your reward points.",
      });
    }

    const bankAccount = await CustomerBankAccount.findOne({ _id: bankAccountId, customerId });
    if (!bankAccount) {
      logger.warn("requestWithdrawal bank account not found", { traceId, customerId, bankAccountId });
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

    // Issue the Razorpay payout outside the Mongo transaction. If this fails,
    // we refund coins and mark the local transaction as failed — the webhook
    // is the only other place that can flip status, and it keys off providerRef.
    try {
      const contact = await createContact({
        name:
          bankAccount.accountHolderName ||
          `${customer._id}`,
        referenceId: `cust_${customer._id}`,
      });
      const fundAccount = await createFundAccount({
        contactId: contact.id,
        accountHolderName: bankAccount.accountHolderName,
        ifsc: bankAccount.ifscCode,
        accountNumber: bankAccount.accountNumber,
      });
      const payout = await createPayout({
        fundAccountId: fundAccount.id,
        amountInPaise: amount * 100,
        referenceId: `txn_${transaction._id}`,
        narration: "Reward withdrawal",
      });

      transaction.providerRef = payout.id;
      await transaction.save();
    } catch (payoutErr: any) {
      logger.error("requestWithdrawal payout failed", { traceId, customerId, transactionId: transaction?._id, error: payoutErr?.message, stack: payoutErr?.stack });
      const refundSession = await mongoose.startSession();
      try {
        await refundSession.withTransaction(async () => {
          await Customer.updateOne(
            { _id: customerId },
            { $inc: { rewardPoints: amount } },
            { session: refundSession }
          );
          transaction.status = RefferalTransactionStatus.FAILED;
          transaction.failureReason = payoutErr.message ?? "Payout could not be initiated.";
          await transaction.save({ session: refundSession });
        });
      } finally {
        refundSession.endSession();
      }
      return res.status(502).json({
        success: false,
        message: "Withdrawal could not be initiated. Please try again.",
      });
    }

    logger.info("requestWithdrawal success", { traceId, customerId, transactionId: transaction._id, amount });
    return res.status(201).json({ success: true, data: transaction });
  } catch (error: any) {
    if (error.issues) { logger.warn("requestWithdrawal validation failed", { traceId, customerId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("requestWithdrawal failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  } finally {
    session.endSession();
  }
};

// ─── Generate Referral Code ───────────────────────────────────────────────────

export const generateReferralCode = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("generateReferralCode invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("generateReferralCode unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    const { referralCode } = generateReferralCodeSchema.parse(req.body);
    const code = referralCode.toUpperCase();

    const customer = await Customer.findOne({
      _id: customerId,
      isAccountDeleted: false,
      status: true,
    }).select("_id referralCode");

    if (!customer) { logger.warn("generateReferralCode customer not found", { traceId, customerId }); return res.status(404).json({ success: false, message: "Invalid user." }); }

    if (customer.referralCode) {
      logger.warn("generateReferralCode already has code", { traceId, customerId });
      return res.status(400).json({
        success: false,
        message: "You can't generate referral code again.",
      });
    }

    const blacklistHit = BLACKLISTED_REFERRAL_WORDS.some((word) => code.includes(word));
    if (blacklistHit) {
      logger.warn("generateReferralCode blacklisted", { traceId, customerId, code });
      return res.status(400).json({
        success: false,
        message: "Referral code is not available, please try another one.",
      });
    }

    const exists = await Customer.exists({ referralCode: code });
    if (exists) {
      logger.warn("generateReferralCode taken", { traceId, customerId, code });
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

    logger.info("generateReferralCode success", { traceId, customerId, code });
    return res.status(200).json({ success: true, data: updated });
  } catch (error: any) {
    if (error.issues) { logger.warn("generateReferralCode validation failed", { traceId, customerId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    if (error.code === 11000) {
      logger.warn("generateReferralCode duplicate", { traceId, customerId });
      return res.status(400).json({
        success: false,
        message: "Referral code is not available, please try another one.",
      });
    }
    logger.error("generateReferralCode failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

// ─── Bank Accounts (for withdrawal payouts) ───────────────────────────────────

export const listBankAccounts = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("listBankAccounts invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("listBankAccounts unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    if (isBankAccountMysql()) {
      const cid = parseBankAccountId(String(customerId));
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
      const accounts = await svcListBankAccounts(cid);
      logger.info("listBankAccounts success", { traceId, customerId, count: accounts.length, source: "mysql" });
      return res.status(200).json({ success: true, data: accounts });
    }

    const accounts = await CustomerBankAccount.find({ customerId }).sort({ createdAt: -1 });
    logger.info("listBankAccounts success", { traceId, customerId, count: accounts.length });
    return res.status(200).json({ success: true, data: accounts });
  } catch (error: any) {
    logger.error("listBankAccounts failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const createBankAccount = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("createBankAccount invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("createBankAccount unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    const parsed = createBankAccountSchema.parse(req.body);
    const ifscDetails = await lookupIfsc(parsed.ifscCode);
    if (!ifscDetails) { logger.warn("createBankAccount invalid IFSC", { traceId, customerId, ifsc: parsed.ifscCode }); return res.status(400).json({ success: false, message: "Invalid IFSC code." }); }

    const { confirmAccountNumber: _confirm, ...rest } = parsed;

    if (isBankAccountMysql()) {
      const cid = parseBankAccountId(String(customerId));
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
      const account = await svcCreateBankAccount({
        customerId: cid,
        accountHolderName: rest.accountHolderName,
        ifscCode: rest.ifscCode,
        accountNumber: rest.accountNumber,
        bankName: ifscDetails.bankName,
        branchName: ifscDetails.branchName,
        city: ifscDetails.city,
      });
      logger.info("createBankAccount success", { traceId, customerId, accountId: account._id, source: "mysql" });
      return res.status(201).json({ success: true, data: account });
    }

    const account = await CustomerBankAccount.create({
      ...rest,
      customerId,
      bankName: ifscDetails.bankName,
      branchName: ifscDetails.branchName,
      city: ifscDetails.city,
    });
    logger.info("createBankAccount success", { traceId, customerId, accountId: account._id });
    return res.status(201).json({ success: true, data: account });
  } catch (error: any) {
    if (error.issues) { logger.warn("createBankAccount validation failed", { traceId, customerId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("createBankAccount failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const updateBankAccount = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("updateBankAccount invoked", { traceId, path: req.originalUrl, customerId, accountId: id });

  try {
    if (!customerId) { logger.warn("updateBankAccount unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    const parsed = updateBankAccountSchema.parse(req.body);
    const { confirmAccountNumber: _confirm, ...rest } = parsed;
    const update: Record<string, unknown> = { ...rest };

    if (parsed.ifscCode) {
      const ifscDetails = await lookupIfsc(parsed.ifscCode);
      if (!ifscDetails) { logger.warn("updateBankAccount invalid IFSC", { traceId, customerId, ifsc: parsed.ifscCode }); return res.status(400).json({ success: false, message: "Invalid IFSC code." }); }
      update.bankName = ifscDetails.bankName;
      update.branchName = ifscDetails.branchName;
      update.city = ifscDetails.city;
    }

    if (isBankAccountMysql()) {
      const cid = parseBankAccountId(String(customerId));
      const aid = parseBankAccountId(id);
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (!aid) { logger.warn("updateBankAccount invalid id", { traceId, customerId, accountId: id }); return res.status(400).json({ success: false, message: "Invalid bank account id." }); }
      const result = await svcUpdateBankAccount(aid, cid, update);
      if (!result.ok) { logger.warn("updateBankAccount not found", { traceId, customerId, accountId: id }); return res.status(result.status).json({ success: false, message: result.message }); }
      logger.info("updateBankAccount success", { traceId, customerId, accountId: id, source: "mysql" });
      return res.status(result.status).json({ success: true, data: result.data });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("updateBankAccount invalid id", { traceId, customerId, accountId: id }); return res.status(400).json({ success: false, message: "Invalid bank account id." }); }

    const account = await CustomerBankAccount.findOneAndUpdate(
      { _id: id, customerId },
      { $set: update },
      { new: true }
    );
    if (!account) { logger.warn("updateBankAccount not found", { traceId, customerId, accountId: id }); return res.status(404).json({ success: false, message: "Bank account not found." }); }
    logger.info("updateBankAccount success", { traceId, customerId, accountId: id });
    return res.status(200).json({ success: true, data: account });
  } catch (error: any) {
    if (error.issues) { logger.warn("updateBankAccount validation failed", { traceId, customerId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("updateBankAccount failed", { traceId, customerId, accountId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};

export const deleteBankAccount = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  const id = req.params.id as string;
  logger.info("deleteBankAccount invoked", { traceId, path: req.originalUrl, customerId, accountId: id });

  try {
    if (!customerId) { logger.warn("deleteBankAccount unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    if (isBankAccountMysql()) {
      const cid = parseBankAccountId(String(customerId));
      const aid = parseBankAccountId(id);
      if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
      if (!aid) { logger.warn("deleteBankAccount invalid id", { traceId, customerId, accountId: id }); return res.status(400).json({ success: false, message: "Invalid bank account id." }); }
      const result = await svcDeleteBankAccount(aid, cid);
      if (!result.ok) { logger.warn("deleteBankAccount not found", { traceId, customerId, accountId: id }); return res.status(result.status).json({ success: false, message: result.message }); }
      logger.info("deleteBankAccount success", { traceId, customerId, accountId: id, source: "mysql" });
      return res.status(200).json({ success: true, message: "Bank account deleted." });
    }

    if (!mongoose.Types.ObjectId.isValid(id)) { logger.warn("deleteBankAccount invalid id", { traceId, customerId, accountId: id }); return res.status(400).json({ success: false, message: "Invalid bank account id." }); }

    const account = await CustomerBankAccount.findOneAndDelete({ _id: id, customerId });
    if (!account) { logger.warn("deleteBankAccount not found", { traceId, customerId, accountId: id }); return res.status(404).json({ success: false, message: "Bank account not found." }); }
    logger.info("deleteBankAccount success", { traceId, customerId, accountId: id });
    return res.status(200).json({ success: true, message: "Bank account deleted." });
  } catch (error: any) {
    logger.error("deleteBankAccount failed", { traceId, customerId, accountId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
