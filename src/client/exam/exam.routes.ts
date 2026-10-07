// Client quizzes: category, daily, attempt, solution and analytics routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { cacheRoute, CacheScope } from "../../middlewares/cacheRoute";
import { CacheEntity } from "../../middlewares/flushGroups";
import { CACHE_TTL } from "../../config/cacheTtl";
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

// Exam categories carry no per-user state → shared cache.
router.get("/categories", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogExam, scope: CacheScope.Shared }), listCategories);
// Embeds isCompleted/lastResult → cached per user. Attempt/detail/solution/history
// routes below are per-attempt and stay uncached.
router.get("/categories/:categoryId/exams", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogExam, scope: CacheScope.User }), listExamsByCategory);
router.get("/daily", cacheRoute({ ttl: CACHE_TTL.DAY, entity: CacheEntity.CatalogExam, scope: CacheScope.User }), getDailyExams);

router.get("/my/attempts", listMyResults);
router.get("/my/past-daily", listMyPastDailyResults);
router.get("/my/analytics", getMyOverallAnalytics);

router.get("/:id/detail", getExamDetail);
router.get("/:id/questions", getExamQuestions);

router.post("/:id/attempts/start", startAttempt);
router.get("/:id/attempts/active", getActiveAttempt);
router.get("/:id/attempts/aggregate", getAttemptsAggregate);
router.get("/:id/attempts", listAttempts);
router.post("/:id/attempts/:attemptId/answer", saveSingleAnswer);
router.post("/:id/attempts/:attemptId/submit", submitAttempt);

router.get("/:id/solution", getSolutionByExam);
router.get("/:id/solution/analytics", getSolutionAnalyticsByExam);
router.get("/:id/solution/download", getSolutionDownloadByExam);

router.post("/:id/rate", rateExamResult);

// `GET /:id` returns questions for taking (same as /:id/questions); kept for old clients.
router.get("/:id", getExamQuestions);

export default router;
