import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadS3Mixed, uploadQuestionImages } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { autoFlushGroup } from "../../middlewares/autoFlush";
import {
  getCategories,
  getCategoryTree,
  getCategoryById,
  getCategoryPackages,
  getCategoryCourses,
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

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

// Route-level response cache + autoFlushGroup on writes (see docs/CACHING.md).
// Category writes flush "exam-category"; exam + question writes flush "exam"
// (questions are exam content). Submissions/analytics/results stay uncached (live).

// Categories
router.get("/categories/tree", cacheRoute({ ttl: 86400, entity: "exam-category" }), getCategoryTree);
router.get("/categories", cacheRoute({ ttl: 86400, entity: "exam-category" }), getCategories);
router.post("/categories", uploadS3.single("image"), autoFlushGroup("exam-category"), createCategory);
router.get("/categories/:id", cacheRoute({ ttl: 86400, entity: "exam-category" }), getCategoryById);
router.get("/categories/:id/packages", getCategoryPackages);
router.get("/categories/:id/courses", getCategoryCourses);
router.put("/categories/:id", uploadS3.single("image"), autoFlushGroup("exam-category"), updateCategory);
router.delete("/categories/:id", autoFlushGroup("exam-category"), deleteCategory);

// Exams
const examUpload = uploadS3Mixed.single("solutionPdfUrl");

router.get("/", cacheRoute({ ttl: 86400, entity: "exam" }), getExams);
router.post("/", examUpload, autoFlushGroup("exam"), createExam);
router.post("/reorder", autoFlushGroup("exam"), reorderExams);
router.get("/:id", cacheRoute({ ttl: 86400, entity: "exam" }), getExamById);
router.put("/:id", examUpload, autoFlushGroup("exam"), updateExam);
router.delete("/:id", autoFlushGroup("exam"), deleteExam);
router.patch("/:id/status", autoFlushGroup("exam"), updateExamStatus);

// Questions
router.get("/questions/list", cacheRoute({ ttl: 86400, entity: "exam" }), getQuestions);
router.post("/questions", uploadQuestionImages.any(), autoFlushGroup("exam"), createQuestion);
router.post("/questions/bulk", autoFlushGroup("exam"), bulkCreateQuestions);
router.post("/questions/reorder", autoFlushGroup("exam"), reorderQuestions);
router.get("/questions/:id", getQuestionById);
router.put("/questions/:id", uploadQuestionImages.any(), autoFlushGroup("exam"), updateQuestion);
router.delete("/questions/:id", autoFlushGroup("exam"), deleteQuestion);

// Submissions / Analytics (live per-attempt — not cached)
router.get("/:examId/submissions", getExamSubmissions);
router.get("/:examId/analytics", getExamAnalytics);
router.get("/results/:id", getResultById);
router.patch("/results/:id/invalidate", invalidateResult);
router.get("/analytics/customer/:customerId", getCustomerAnalytics);

export default router;
