import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { uploadS3, uploadS3Mixed, uploadQuestionImages } from "../../middlewares/upload";
import { cacheRoute } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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
router.get("/categories/tree", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCategory }), getCategoryTree);
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCategory }), getCategories);
router.post("/categories", uploadS3.single("image"), autoFlushGroup(CacheEntity.ExamCategory), createCategory);
router.get("/categories/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.ExamCategory }), getCategoryById);
router.get("/categories/:id/packages", getCategoryPackages);
router.get("/categories/:id/courses", getCategoryCourses);
router.put("/categories/:id", uploadS3.single("image"), autoFlushGroup(CacheEntity.ExamCategory), updateCategory);
router.delete("/categories/:id", autoFlushGroup(CacheEntity.ExamCategory), deleteCategory);

// Exams
const examUpload = uploadS3Mixed.single("solutionPdfUrl");

router.get("/", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Exam }), getExams);
router.post("/", examUpload, autoFlushGroup(CacheEntity.Exam), createExam);
router.post("/reorder", autoFlushGroup(CacheEntity.Exam), reorderExams);
router.get("/:id", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Exam }), getExamById);
router.put("/:id", examUpload, autoFlushGroup(CacheEntity.Exam), updateExam);
router.delete("/:id", autoFlushGroup(CacheEntity.Exam), deleteExam);
router.patch("/:id/status", autoFlushGroup(CacheEntity.Exam), updateExamStatus);

// Questions
router.get("/questions/list", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.Exam }), getQuestions);
router.post("/questions", uploadQuestionImages.any(), autoFlushGroup(CacheEntity.Exam), createQuestion);
router.post("/questions/bulk", autoFlushGroup(CacheEntity.Exam), bulkCreateQuestions);
router.post("/questions/reorder", autoFlushGroup(CacheEntity.Exam), reorderQuestions);
router.get("/questions/:id", getQuestionById);
router.put("/questions/:id", uploadQuestionImages.any(), autoFlushGroup(CacheEntity.Exam), updateQuestion);
router.delete("/questions/:id", autoFlushGroup(CacheEntity.Exam), deleteQuestion);

// Submissions / Analytics (live per-attempt — not cached)
router.get("/:examId/submissions", getExamSubmissions);
router.get("/:examId/analytics", getExamAnalytics);
router.get("/results/:id", getResultById);
router.patch("/results/:id/invalidate", invalidateResult);
router.get("/analytics/customer/:customerId", getCustomerAnalytics);

export default router;
