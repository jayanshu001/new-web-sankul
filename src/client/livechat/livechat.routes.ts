import { Router } from "express";
import authenticate from "../../middlewares/authenticate";
import { getChatHistory, getChatBanStatus } from "./livechat.controller";

const router = Router();

// GET /api/v1/client/live-chat/ban-status
router.get("/ban-status", authenticate, getChatBanStatus);

// GET /api/v1/client/live-chat/:liveClassId/history?limit=50&before=<ISO date>
router.get("/:liveClassId/history", authenticate, getChatHistory);

export default router;
