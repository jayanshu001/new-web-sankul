// Admin rank predictor: mounts paper, submission and answer-key routes.
import { Router } from "express";
import { UPLOAD_FOLDERS } from "../../config/uploadFolders";
import { enforceMixedSizeLimits, uploadS3Mixed, uploadTo } from "../../middlewares/upload";
import { setAnswerKeyStatus } from "./answerKeys.controller";
import papersRoutes from "./papers.routes";
import submissionsRoutes from "./submissions.routes";
import { validate } from "../../middlewares/validate";
import {
  rankSuggestionSchema,
  suggestionIdParamSchema,
} from "../../modules/rank-suggestions/rank-suggestion.validation";
import { applySuggestionImage, deleteSuggestion, updateSuggestion } from "./suggestions.controller";

const router = Router();

router.use("/papers", papersRoutes);
router.use("/submissions", submissionsRoutes);
router.patch("/answer-keys/:id/status", setAnswerKeyStatus);
router.put(
  "/suggestions/:id",
  validate({ params: suggestionIdParamSchema }),
  uploadTo(UPLOAD_FOLDERS.rankSuggestions),
  uploadS3Mixed.fields([{ name: "image", maxCount: 1 }]),
  enforceMixedSizeLimits,
  applySuggestionImage,
  validate({ body: rankSuggestionSchema }),
  updateSuggestion
);
router.delete("/suggestions/:id", validate({ params: suggestionIdParamSchema }), deleteSuggestion);

export default router;
