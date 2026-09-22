import { Router } from "express";
import { setAnswerKeyStatus } from "./answerKeys.controller";
import papersRoutes from "./papers.routes";
import submissionsRoutes from "./submissions.routes";

const router = Router();

router.use("/papers", papersRoutes);
router.use("/submissions", submissionsRoutes);
router.patch("/answer-keys/:id/status", setAnswerKeyStatus);

export default router;
