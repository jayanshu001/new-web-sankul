import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
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

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Programs
router.get("/programs", getPrograms);
router.post("/programs", createProgram);
router.get("/programs/:id", getProgramById);
router.put("/programs/:id", updateProgram);
router.delete("/programs/:id", deleteProgram);

// Referrers (all customers with a generated referral code + stats)
router.get("/referrers", getReferrers);

// Transactions
router.get("/transactions", getTransactions);
router.patch("/transactions/:id/status", updateWithdrawalStatus);
router.post("/transactions/:id/reject", rejectWithdrawal);

// Withdrawals CSV
router.get("/withdrawals/csv", exportWithdrawalsCsv);

// Manual reward adjustment
router.post("/customers/:customerId/rewards", adjustCustomerRewards);

// Terms & Conditions
router.get("/terms", listTerms);
router.post("/terms", createTerm);
router.get("/terms/:id", getTerm);
router.put("/terms/:id", updateTerm);
router.delete("/terms/:id", deleteTerm);

// FAQs
router.get("/faqs", listFaqs);
router.post("/faqs", createFaq);
router.get("/faqs/:id", getFaq);
router.put("/faqs/:id", updateFaq);
router.delete("/faqs/:id", deleteFaq);

export default router;
