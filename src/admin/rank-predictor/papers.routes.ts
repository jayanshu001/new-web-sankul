import { Router } from "express";
import { uploadRankPdfToMemory } from "../../middlewares/upload";
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

const router = Router();

router.get("/", listPapers);
router.post("/", createPaper);
router.get("/:id", getPaper);
router.put("/:id", updatePaper);
router.patch("/:id/status", setPaperStatus);
router.delete("/:id", deletePaper);

router.get("/:examId/answer-keys", listAnswerKeys);
router.post("/:examId/answer-keys", uploadRankPdfToMemory.single("file"), publishAnswerKey);

router.get("/:examId/leaderboard", getPaperLeaderboard);

export default router;
