// Admin live chat: message, settings, history and ban routes.
import { Router } from "express";
import authenticate, { requireRole } from "../../middlewares/authenticate";
import {
  sendAdminMessage,
  getChatHistory,
  deleteChatMessage,
  banCustomerFromChat,
  unbanCustomerFromChat,
  listChatBans,
  getChatSettings,
  updateChatSettings,
} from "./livechat.controller";

const router = Router();

router.use(authenticate); // authz: catalog RBAC (enforceRbac) + router-level staff gate

router.post("/message",                       sendAdminMessage);
router.get("/bans",                           listChatBans);
router.post("/bans",                          banCustomerFromChat);
router.delete("/bans/:customerId",            unbanCustomerFromChat);
router.delete("/messages/:messageId",         deleteChatMessage);
router.get("/:liveClassId/history",           getChatHistory);
router.get("/:liveClassId/settings",          getChatSettings);
router.patch("/:liveClassId/settings",        updateChatSettings);

export default router;
