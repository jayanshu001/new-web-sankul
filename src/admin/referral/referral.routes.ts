import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { idempotency } from "../../middlewares/idempotency";
import { adminMutationLimiter } from "../../config/rateLimiter";
import {
  getPrograms,
  getProgramById,
  createProgram,
  updateProgram,
  deleteProgram,
  getTransactions,
  updateWithdrawalStatus,
  rejectWithdrawal,
  exportWithdrawalsCsv,
  getWithdrawalsReport,
  adjustCustomerRewards,
  getReferrers,
} from "./referral.controller";
import {
  listTerms,
  getTerm,
  createTerm,
  updateTerm,
  deleteTerm,
  listFaqs,
  getFaq,
  createFaq,
  updateFaq,
  deleteFaq,
} from "./content.controller";

import { autoFlushGroup } from "../../middlewares/autoFlush";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Programs
router.get("/programs", getPrograms);
router.post("/programs", createProgram);
router.get("/programs/:id", getProgramById);
router.put("/programs/:id", updateProgram);
router.delete("/programs/:id", deleteProgram);

// Referrers (all customers with a generated referral code + stats)
router.get("/referrers", getReferrers);

// Transactions
//
// Withdrawal status changes and manual reward adjustments are financial
// mutations: each must be retry-safe (network/client retries must not
// double-credit a customer). We enforce `Idempotency-Key` here (P1 audit gap)
// and apply a per-admin mutation rate limit on top of the global admin limiter.
router.get("/transactions", getTransactions);
router.patch(
  "/transactions/:id/status",
  adminMutationLimiter,
  idempotency({ scope: "referral.withdrawal.status" }),
  updateWithdrawalStatus
);
router.post(
  "/transactions/:id/reject",
  adminMutationLimiter,
  idempotency({ scope: "referral.withdrawal.reject" }),
  rejectWithdrawal
);

// Withdrawal Report (listing + CSV)
router.get("/withdrawals", getWithdrawalsReport);
router.get("/withdrawals/csv", exportWithdrawalsCsv);

// Manual reward adjustment (credit/debit a customer's reward balance)
router.post(
  "/customers/:customerId/rewards",
  adminMutationLimiter,
  idempotency({ scope: "referral.rewards.adjust" }),
  adjustCustomerRewards
);

// Terms & Conditions — the SAME rcService rows GET /client/referral/terms
// serves under the "terms" tag, so these writes must sweep it.
router.get("/terms", listTerms);
router.post("/terms", autoFlushGroup("terms"), createTerm);
router.get("/terms/:id", getTerm);
router.put("/terms/:id", autoFlushGroup("terms"), updateTerm);
router.delete("/terms/:id", autoFlushGroup("terms"), deleteTerm);

// FAQs — likewise paired with GET /client/referral/faqs ("faq" tag).
router.get("/faqs", listFaqs);
router.post("/faqs", autoFlushGroup("faq"), createFaq);
router.get("/faqs/:id", getFaq);
router.put("/faqs/:id", autoFlushGroup("faq"), updateFaq);
router.delete("/faqs/:id", autoFlushGroup("faq"), deleteFaq);

export default router;
