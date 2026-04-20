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
} from "./referral.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Programs
router.get("/programs", getPrograms);
router.post("/programs", createProgram);
router.get("/programs/:id", getProgramById);
router.put("/programs/:id", updateProgram);
router.delete("/programs/:id", deleteProgram);

// Transactions
router.get("/transactions", getTransactions);
router.patch("/transactions/:id/status", updateWithdrawalStatus);
router.post("/transactions/:id/reject", rejectWithdrawal);

// Withdrawals CSV
router.get("/withdrawals/csv", exportWithdrawalsCsv);

// Manual reward adjustment
router.post("/customers/:customerId/rewards", adjustCustomerRewards);

export default router;
