import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listCategories,
  listExamsByCategory,
  getDailyExams,
  getExamQuestions,
  getExamDetail,
  saveAnswers,
  getSolutionByExam,
  getSolutionAnalyticsByExam,
  getSolutionDownloadByExam,
  listMyResults,
  getMyOverallAnalytics,
  rateExamResult,
} from "./exam.controller";

const router = Router();

router.use(authenticate);

// Discovery
router.get("/categories", listCategories);
router.get("/categories/:categoryId/exams", listExamsByCategory);
router.get("/daily", getDailyExams);

// My history / analytics
router.get("/my/attempts", listMyResults);
router.get("/my/analytics", getMyOverallAnalytics);

// Exam detail (meta only) + taking
router.get("/:id/detail", getExamDetail);
router.get("/:id/questions", getExamQuestions);

// Post-submit views (keyed by examId, as in old API)
router.get("/:id/solution", getSolutionByExam);
router.get("/:id/solution/analytics", getSolutionAnalyticsByExam);
router.get("/:id/solution/download", getSolutionDownloadByExam);

// Submit rating
router.post("/:id/rate", rateExamResult);

// Old-API compat: `GET /:id` returned questions for taking (same as /:id/questions)
router.get("/:id", getExamQuestions);

export default router;
