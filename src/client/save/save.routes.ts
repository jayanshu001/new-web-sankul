// Client exam answers: save-answers route (handled by the exam controller).
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { saveAnswers } from "../exam/exam.controller";

const router = Router();

router.use(authenticate);

router.post("/answers", saveAnswers);

export default router;
