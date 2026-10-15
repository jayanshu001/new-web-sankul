// Admin rank predictor: paper, answer-key and leaderboard routes.
import { Router } from "express";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import {
  enforceMixedSizeLimits,
  uploadRankPdfToMemory,
  uploadS3Mixed,
  uploadTo,
} from "../../middlewares/upload";
import { listAnswerKeys, publishAnswerKey } from "./answerKeys.controller";
import {
  createPaper,
  deletePaper,
  getPaper,
  getPaperLeaderboard,
  listPapers,
  setPaperStatus,
  updatePaper,
} from "./papers.controller";
import { validate } from "../../middlewares/validate";
import { examIdParamSchema } from "../../modules/rank-predictor/rank-predictor.validation";
import { rankSuggestionSchema } from "../../modules/rank-suggestions/rank-suggestion.validation";
import { applySuggestionImage, createSuggestion, listSuggestions } from "./suggestions.controller";

const router = Router();
const suggestionImageUpload = [
  uploadTo(UPLOAD_FOLDERS.rankSuggestions),
  uploadS3Mixed.fields([{ name: "image", maxCount: 1 }]),
  enforceMixedSizeLimits,
  applySuggestionImage,
];

router.get("/", listPapers);
router.post("/", createPaper);
router.get("/:id", getPaper);
router.put("/:id", updatePaper);
router.patch("/:id/status", setPaperStatus);
router.delete("/:id", deletePaper);

router.get("/:examId/answer-keys", listAnswerKeys);
router.post("/:examId/answer-keys", uploadRankPdfToMemory.single("file"), publishAnswerKey);

router.get("/:examId/leaderboard", getPaperLeaderboard);

router.get("/:examId/suggestions", validate({ params: examIdParamSchema }), listSuggestions);
router.post(
  "/:examId/suggestions",
  validate({ params: examIdParamSchema }),
  suggestionImageUpload,
  validate({ body: rankSuggestionSchema }),
  createSuggestion
);

export default router;
