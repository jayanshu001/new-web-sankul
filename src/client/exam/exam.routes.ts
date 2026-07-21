import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute } from "../../middlewares/cacheRoute";
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
  listMyPastDailyResults,
  getMyOverallAnalytics,
  rateExamResult,
  startAttempt,
  saveSingleAnswer,
  submitAttempt,
  getActiveAttempt,
  listAttempts,
  getAttemptsAggregate,
} from "./exam.controller";

const router = Router();

router.use(authenticate);

// Discovery — Tier-1: exam categories carry no per-user state.
router.get("/categories", cacheRoute({ ttl: 86400, entity: "catalog-exam", scope: "shared" }), listCategories);
// Tier-2 (embeds isCompleted/lastResult) → cached per-user + short TTL (ebook
// precedent), entity:"catalog-exam" (admin exam writes flush it). Attempt/detail/
// solution/history routes below are per-attempt and stay uncached.
router.get("/categories/:categoryId/exams", cacheRoute({ ttl: 86400, entity: "catalog-exam", scope: "user" }), listExamsByCategory);
router.get("/daily", cacheRoute({ ttl: 86400, entity: "catalog-exam", scope: "user" }), getDailyExams);

// My history / analytics
router.get("/my/attempts", listMyResults);
router.get("/my/past-daily", listMyPastDailyResults);
router.get("/my/analytics", getMyOverallAnalytics);

// Exam detail (meta only) + taking
router.get("/:id/detail", getExamDetail);
router.get("/:id/questions", getExamQuestions);

// Attempt lifecycle
router.post("/:id/attempts/start", startAttempt);
router.get("/:id/attempts/active", getActiveAttempt);
router.get("/:id/attempts/aggregate", getAttemptsAggregate);
router.get("/:id/attempts", listAttempts);
router.post("/:id/attempts/:attemptId/answer", saveSingleAnswer);
router.post("/:id/attempts/:attemptId/submit", submitAttempt);

// Post-submit views (keyed by examId, as in old API)
router.get("/:id/solution", getSolutionByExam);
router.get("/:id/solution/analytics", getSolutionAnalyticsByExam);
router.get("/:id/solution/download", getSolutionDownloadByExam);

// Submit rating
router.post("/:id/rate", rateExamResult);

// Old-API compat: `GET /:id` returned questions for taking (same as /:id/questions)
router.get("/:id", getExamQuestions);

export default router;
