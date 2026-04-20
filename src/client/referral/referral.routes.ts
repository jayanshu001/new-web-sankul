import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  getRewardsOverview,
  getMyTransactions,
  requestWithdrawal,
  generateReferralCode,
  listBankAccounts,
  createBankAccount,
  updateBankAccount,
  deleteBankAccount,
} from "./referral.controller";

const router = Router();

router.use(authenticate);

// Overview + ledger
router.get("/rewards", getRewardsOverview);
router.get("/transactions", getMyTransactions);

// Referral code (user-chosen, one-time)
router.post("/code/generate", generateReferralCode);

// Withdrawal request
router.post("/withdraw", requestWithdrawal);

// Bank accounts (payout targets)
router.get("/bank-accounts", listBankAccounts);
router.post("/bank-accounts", createBankAccount);
router.put("/bank-accounts/:id", updateBankAccount);
router.delete("/bank-accounts/:id", deleteBankAccount);

export default router;
