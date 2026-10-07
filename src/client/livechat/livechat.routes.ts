// Client live chat: history and ban-status routes.
import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { getChatHistory, getChatBanStatus } from "./livechat.controller";

const router = Router();

router.get("/ban-status", authenticate, getChatBanStatus);

router.get("/:liveClassId/history", authenticate, getChatHistory);

export default router;
