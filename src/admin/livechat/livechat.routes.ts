import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import { sendAdminMessage, getChatHistory } from "./livechat.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin", "editor"));

router.post("/message", sendAdminMessage);                    // POST  /api/v1/admin/live-chat/message
router.get("/:liveClassId/history", getChatHistory);          // GET   /api/v1/admin/live-chat/:liveClassId/history

export default router;
