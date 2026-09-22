import { Router } from "express";
import authenticate, { optionalAuthenticate } from "../../middlewares/authenticate";
import { uploadRankPdfToMemory } from "../../middlewares/upload";
import { validate } from "../../middlewares/validate";
import {
  candidateProfileSchema,
  correctionsSchema,
  examIdParamSchema,
  examListQuerySchema,
  leaderboardPrivacySchema,
  leaderboardQuerySchema,
  submissionCreateSchema,
  submissionIdParamSchema,
} from "../../modules/rank-predictor/rank-predictor.validation";
import {
  confirmSubmission,
  createSubmission,
  getCandidateProfile,
  getExam,
  getLeaderboard,
  getLeaderboardPrivacy,
  getMyAnswerReview,
  getMyRank,
  getMyRanks,
  getSubmission,
  getSubmissionFile,
  listExams,
  saveCandidateProfile,
  setLeaderboardPrivacy,
} from "./rank-predictor.controller";

const router = Router();

router.get("/papers", optionalAuthenticate, validate({ query: examListQuerySchema }), listExams);
router.get(
  "/papers/:examId",
  optionalAuthenticate,
  validate({ params: examIdParamSchema }),
  getExam
);
router.get(
  "/papers/:examId/leaderboard",
  optionalAuthenticate,
  validate({ params: examIdParamSchema, query: leaderboardQuerySchema }),
  getLeaderboard
);

router.use(authenticate);

router.post(
  "/papers/:examId/submissions",
  validate({ params: examIdParamSchema }),
  uploadRankPdfToMemory.single("file"),
  validate({ body: submissionCreateSchema }),
  createSubmission
);

router.get(
  "/papers/:examId/submissions/:submissionId",
  validate({ params: submissionIdParamSchema }),
  getSubmission
);

router.get(
  "/papers/:examId/submissions/:submissionId/file",
  validate({ params: submissionIdParamSchema }),
  getSubmissionFile
);

router.post(
  "/papers/:examId/submissions/:submissionId/confirm",
  validate({ params: submissionIdParamSchema, body: correctionsSchema }),
  confirmSubmission
);

router.get("/papers/:examId/rank/me", validate({ params: examIdParamSchema }), getMyRank);
router.get(
  "/papers/:examId/review/me",
  validate({ params: examIdParamSchema }),
  getMyAnswerReview
);

router.get("/me/ranks", getMyRanks);
router.get("/me/candidate-profile", getCandidateProfile);
router.put(
  "/me/candidate-profile",
  validate({ body: candidateProfileSchema }),
  saveCandidateProfile
);

router.get("/me/leaderboard-privacy", getLeaderboardPrivacy);
router.patch(
  "/me/leaderboard-privacy",
  validate({ body: leaderboardPrivacySchema }),
  setLeaderboardPrivacy
);

export default router;
