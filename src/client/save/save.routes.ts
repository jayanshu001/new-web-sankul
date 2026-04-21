import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { saveAnswers } from "../exam/exam.controller";

/**
 * Old-API compat: `POST /api/v1/client/save/answers`
 * Matches old backend's `/save/answers` endpoint.
 */
const router = Router();

router.use(authenticate);

router.post("/answers", saveAnswers);

export default router;
