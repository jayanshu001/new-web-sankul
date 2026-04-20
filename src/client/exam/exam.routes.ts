import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import {
  listCategories,
  listExamsByCategory,
  getDailyExams,
  getExamDetail,
  startAttempt,
  getAttemptQuestions,
  autosaveAnswers,
  submitAttempt,
  getAttemptSolution,
  getAttemptAnalytics,
  listMyAttempts,
  getMyOverallAnalytics,
} from "./exam.controller";

const router = Router();

router.use(authenticate);

// Discovery
router.get("/categories", listCategories);
router.get("/categories/:categoryId/exams", listExamsByCategory);
router.get("/daily", getDailyExams);

// My attempt history + summary
router.get("/my/attempts", listMyAttempts);
router.get("/my/analytics", getMyOverallAnalytics);

// Exam detail + lifecycle
router.get("/:id", getExamDetail);
router.post("/:id/attempts", startAttempt);
router.get("/:id/attempts/:attemptId/questions", getAttemptQuestions);
router.patch("/attempts/:attemptId/answers", autosaveAnswers);
router.post("/:id/attempts/:attemptId/submit", submitAttempt);

// Post-submit views
router.get("/attempts/:attemptId/solution", getAttemptSolution);
router.get("/attempts/:attemptId/analytics", getAttemptAnalytics);

export default router;
