import { Router } from "express";
import {
  correctAnswers,
  deleteSubmission,
  getSubmission,
  getSubmissionFile,
  listSubmissions,
  rereadSubmission,
  rescoreSubmission,
} from "./submissions.controller";

const router = Router();

router.get("/", listSubmissions);
router.get("/:id", getSubmission);
router.get("/:id/file", getSubmissionFile);
router.put("/:id/answers", correctAnswers);
router.post("/:id/rescore", rescoreSubmission);
router.post("/:id/reread", rereadSubmission);
router.delete("/:id", deleteSubmission);

export default router;
