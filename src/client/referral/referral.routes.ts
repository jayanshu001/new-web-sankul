import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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
import { getTerms, getFaqs, getReferralStatus } from "./content.controller";

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

// Refer & Earn content. /status is per-user (uncached); terms + faqs are Tier-1
// shared, flushed by admin terms/faq writes (see docs/CACHING.md).
router.get("/status", getReferralStatus);
router.get("/terms", cacheRoute({ ttl: 86400, entity: "terms", scope: "shared" }), getTerms);
router.get("/faqs", cacheRoute({ ttl: 86400, entity: "faq", scope: "shared" }), getFaqs);

export default router;
