import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  getCategories,
  getCategoryTree,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  getExams,
  getExamById,
  createExam,
  updateExam,
  deleteExam,
  updateExamStatus,
  reorderExams,
  getQuestions,
  getQuestionById,
  createQuestion,
  bulkCreateQuestions,
  updateQuestion,
  deleteQuestion,
  reorderQuestions,
  getExamSubmissions,
  getExamAnalytics,
  getResultById,
  invalidateResult,
  getCustomerAnalytics,
} from "./exam.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin"));

// Categories
router.get("/categories/tree", getCategoryTree);
router.get("/categories", getCategories);
router.post("/categories", createCategory);
router.get("/categories/:id", getCategoryById);
router.put("/categories/:id", updateCategory);
router.delete("/categories/:id", deleteCategory);

// Exams
router.get("/", getExams);
router.post("/", createExam);
router.post("/reorder", reorderExams);
router.get("/:id", getExamById);
router.put("/:id", updateExam);
router.delete("/:id", deleteExam);
router.patch("/:id/status", updateExamStatus);

// Questions
router.get("/questions/list", getQuestions);
router.post("/questions", createQuestion);
router.post("/questions/bulk", bulkCreateQuestions);
router.post("/questions/reorder", reorderQuestions);
router.get("/questions/:id", getQuestionById);
router.put("/questions/:id", updateQuestion);
router.delete("/questions/:id", deleteQuestion);

// Submissions / Analytics
router.get("/:examId/submissions", getExamSubmissions);
router.get("/:examId/analytics", getExamAnalytics);
router.get("/results/:id", getResultById);
router.patch("/results/:id/invalidate", invalidateResult);
router.get("/analytics/customer/:customerId", getCustomerAnalytics);

export default router;
