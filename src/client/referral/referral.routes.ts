import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getRewardsOverview,
  getMyTransactions,
  getTransactionById,
  requestWithdrawal,
  generateReferralCode,
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from "./referral.controller";
import { getTerms, getFaqs } from "./content.controller";

const router = Router();

router.use(authenticate);

// Overview + ledger
router.get("/rewards", getRewardsOverview);
router.get("/transactions", getMyTransactions);
router.get("/transactions/:id", getTransactionById);

// Referral code (user-chosen, one-time)
router.post("/code/generate", generateReferralCode);

// Withdrawal request
router.post("/withdraw", requestWithdrawal);

// Bank accounts (payout targets)
router.get("/bank-accounts", listBankAccounts);
router.post("/bank-accounts", createBankAccount);
router.put("/bank-accounts/:id", updateBankAccount);
router.delete("/bank-accounts/:id", deleteBankAccount);

// Refer & Earn content
router.get("/terms", getTerms);
router.get("/faqs", getFaqs);

export default router;
