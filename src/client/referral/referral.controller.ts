import { Request, Response } from "express";
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
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import { pick, omit, omitList } from "../../utils/pick";
import {
  parseBankAccountId,
  listBankAccounts as svcListBankAccounts,
  getBankAccount as svcGetBankAccount,
  createBankAccount as svcCreateBankAccount,
  updateBankAccount as svcUpdateBankAccount,
  deleteBankAccount as svcDeleteBankAccount,
} from "../../modules/customer-bank-account/customer-bank-account.service";
import {
  parseCustomerId as parseRefCustomerId,
  getRewardsOverview as svcRewardsOverview,
  listTransactions as svcListTransactions,
  getTransaction as svcGetTransaction,
  getRewardPoints as svcGetRewardPoints,
  createWithdrawal as svcCreateWithdrawal,
  attachProviderRef as svcAttachProviderRef,
  refundWithdrawal as svcRefundWithdrawal,
  generateReferralCode as svcGenerateReferralCode,
} from "../../modules/referral/referral.service";

const MIN_WITHDRAWAL_AMOUNT = 500;

// ─── Rewards Screen ───────────────────────────────────────────────────────────

export const getRewardsOverview = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = req.user?.id;
  logger.info("getRewardsOverview invoked", { traceId, path: req.originalUrl, customerId });

  try {
    if (!customerId) { logger.warn("getRewardsOverview unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized" }); }

    // ─── ws_customer + ws_refferal_program ────────────────────────────────
    const cid = parseRefCustomerId(customerId);
    if (!cid) return res.status(404).json({ success: false, message: "Invalid user." });
    const data = await svcRewardsOverview(cid);
    if (!data) return res.status(404).json({ success: false, message: "Invalid user." });
    // RN reads only customer.rewardPoints + referralCode (identity fields +
    // program[] unused). See docs/api-optimization Phase 3.
    return res.status(200).json({
      success: true,
      data: { customer: pick(data.customer as any, ["rewardPoints", "referralCode"]) },
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

    const { type } = req.query as Record<string, string>;
    const { search, page: pageNum, limit: limitNum } = parseListQuery(req.query);

    // ─── ws_refferal_transaction ──────────────────────────────────────────
    const cid = parseRefCustomerId(customerId);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { items, total } = await svcListTransactions(cid, { type, search, page: pageNum, limit: limitNum });
    logger.info("getMyTransactions success (sql)", { traceId, customerId, total });
    // MyRewards reads _id/coin/status/createdAt + bankAccount.{bankName,accountNumber}
    // only (see docs/api-optimization/GET_client_referral_transactions.md).
    const data = (items ?? []).map((t: any) => ({
      ...omit(t, ["orderId", "customerId", "type", "description", "providerRef", "failureReason", "updatedAt"]),
      bankAccount: t.bankAccount ? pick(t.bankAccount, ["bankName", "accountNumber"]) : null,
    }));
    return res.status(200).json({
      success: true,
      data,
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

    const cid = parseRefCustomerId(customerId);
    const tid = Number(id);
    if (!cid || !Number.isInteger(tid) || tid <= 0) return res.status(400).json({ success: false, message: "Invalid transaction id." });
    const t = await svcGetTransaction(tid, cid);
    if (!t) return res.status(404).json({ success: false, message: "Transaction not found." });
    return res.status(200).json({ success: true, data: t });
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

    // ─── ws_customer + ws_customer_bank_account + ws_refferal_transaction ───
    const cid = parseRefCustomerId(customerId);
    const baId = parseBankAccountId(bankAccountId);
    if (!cid) return res.status(404).json({ success: false, message: "Invalid user." });
    if (!baId) return res.status(400).json({ success: false, message: "Invalid bank account id." });

    const points = await svcGetRewardPoints(cid);
    if (points === null) return res.status(404).json({ success: false, message: "Invalid user." });
    if (amount > points) {
      return res.status(400).json({ success: false, message: "Your withdrawal request must be less than or equal to your reward points." });
    }

    const bankAccount = await svcGetBankAccount(baId, cid);
    if (!bankAccount) return res.status(404).json({ success: false, message: "Bank account not found." });

    // Atomic: decrement points + create pending DEBIT txn.
    const txn = await svcCreateWithdrawal({ customerId: cid, amount, bankAccount: bankAccount as any });

    // Razorpay payout outside the DB tx; refund + mark failed on error.
    try {
      const contact = await createContact({ name: (bankAccount as any).accountHolderName || `${cid}`, referenceId: `cust_${cid}` });
      const fundAccount = await createFundAccount({
        contactId: contact.id,
        accountHolderName: (bankAccount as any).accountHolderName,
        ifsc: (bankAccount as any).ifscCode,
        accountNumber: (bankAccount as any).accountNumber,
      });
      const payout = await createPayout({ fundAccountId: fundAccount.id, amountInPaise: amount * 100, referenceId: `txn_${txn._id}`, narration: "Reward withdrawal" });
      await svcAttachProviderRef(Number(txn._id), payout.id);
      txn.providerRef = payout.id;
    } catch (payoutErr: any) {
      logger.error("requestWithdrawal payout failed (sql)", { traceId, customerId, transactionId: txn._id, error: payoutErr?.message });
      await svcRefundWithdrawal({ transactionId: Number(txn._id), customerId: cid, amount, reason: payoutErr?.message ?? "Payout could not be initiated." });
      return res.status(502).json({ success: false, message: "Withdrawal could not be initiated. Please try again." });
    }

    logger.info("requestWithdrawal success (sql)", { traceId, customerId, transactionId: txn._id, amount });
    return res.status(201).json({ success: true, data: txn });
  } catch (error: any) {
    if (error.issues) { logger.warn("requestWithdrawal validation failed", { traceId, customerId, issues: error.issues }); return res.status(400).json({ success: false, errors: error.issues }); }
    logger.error("requestWithdrawal failed", { traceId, customerId, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
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

    const blacklistHitEarly = BLACKLISTED_REFERRAL_WORDS.some((word) => code.includes(word));

    const cid = parseRefCustomerId(customerId);
    if (!cid) return res.status(404).json({ success: false, message: "Invalid user." });
    if (blacklistHitEarly) {
      return res.status(400).json({ success: false, message: "Referral code is not available, please try another one." });
    }
    const result = await svcGenerateReferralCode(cid, code);
    if (!result.ok) {
      if (result.reason === "not_found") return res.status(404).json({ success: false, message: "Invalid user." });
      if (result.reason === "already") return res.status(400).json({ success: false, message: "You can't generate referral code again." });
      return res.status(400).json({ success: false, message: "Referral code is not available, please try another one." });
    }
    logger.info("generateReferralCode success (sql)", { traceId, customerId, code });
    return res.status(200).json({ success: true, data: result.data });
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

    const { search, page, limit, skip } = parseListQuery(req.query);

    const cid = parseBankAccountId(String(customerId));
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
    const { items, total } = await svcListBankAccounts(cid, { search, skip, take: limit });
    logger.info("listBankAccounts success", { traceId, customerId, count: items.length, source: "mysql" });
    // BankDetails renders _id/accountHolderName/accountNumber/bankName only
    // (see docs/api-optimization/GET_client_referral_bank_accounts.md).
    const data = omitList(items, ["ifscCode", "customerId", "branchName", "city", "createdAt", "updatedAt"]);
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
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

    const cid = parseBankAccountId(String(customerId));
    const aid = parseBankAccountId(id);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!aid) { logger.warn("updateBankAccount invalid id", { traceId, customerId, accountId: id }); return res.status(400).json({ success: false, message: "Invalid bank account id." }); }
    const result = await svcUpdateBankAccount(aid, cid, update);
    if (!result.ok) { logger.warn("updateBankAccount not found", { traceId, customerId, accountId: id }); return res.status(result.status).json({ success: false, message: result.message }); }
    logger.info("updateBankAccount success", { traceId, customerId, accountId: id, source: "mysql" });
    return res.status(result.status).json({ success: true, data: result.data });
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

    const cid = parseBankAccountId(String(customerId));
    const aid = parseBankAccountId(id);
    if (!cid) return res.status(401).json({ success: false, message: "Unauthorized" });
    if (!aid) { logger.warn("deleteBankAccount invalid id", { traceId, customerId, accountId: id }); return res.status(400).json({ success: false, message: "Invalid bank account id." }); }
    const result = await svcDeleteBankAccount(aid, cid);
    if (!result.ok) { logger.warn("deleteBankAccount not found", { traceId, customerId, accountId: id }); return res.status(result.status).json({ success: false, message: result.message }); }
    logger.info("deleteBankAccount success", { traceId, customerId, accountId: id, source: "mysql" });
    return res.status(200).json({ success: true, message: "Bank account deleted." });
  } catch (error: any) {
    logger.error("deleteBankAccount failed", { traceId, customerId, accountId: id, error: getErrorMessage(error), stack: error.stack });
    return res.status(500).json({ success: false, message: error.message });
  }
};
