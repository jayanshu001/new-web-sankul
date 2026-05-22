import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  sendAdminMessage,
  getChatHistory,
  deleteChatMessage,
  banCustomerFromChat,
  unbanCustomerFromChat,
  listChatBans,
} from "./livechat.controller";

const router = Router();

router.use(authenticate, requireRole("admin", "super_admin", "editor"));

router.post("/message",                       sendAdminMessage);        // POST   /api/v1/admin/live-chat/message
router.get("/bans",                           listChatBans);            // GET    /api/v1/admin/live-chat/bans
router.post("/bans",                          banCustomerFromChat);     // POST   /api/v1/admin/live-chat/bans
router.delete("/bans/:customerId",            unbanCustomerFromChat);   // DELETE /api/v1/admin/live-chat/bans/:customerId
router.delete("/messages/:messageId",         deleteChatMessage);       // DELETE /api/v1/admin/live-chat/messages/:messageId
router.get("/:liveClassId/history",           getChatHistory);          // GET    /api/v1/admin/live-chat/:liveClassId/history

export default router;
