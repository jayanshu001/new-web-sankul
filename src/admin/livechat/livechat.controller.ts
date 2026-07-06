import { Request, Response } from "express";
import { io, roomKey, disconnectChatSocketsForCustomer, emitChatUnbannedForCustomer } from "../../socket/livechat.socket";
import { resolveLiveClassId } from "../live/live.guards";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";
import { adminAuthRepository } from "../../modules/admin-auth/admin-auth.repository";

// POST /api/v1/admin/live-chat/message
export const sendAdminMessage = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("sendAdminMessage invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { liveClassId, message } = req.body;

    const streamId = await resolveLiveClassId(liveClassId);
    if (!streamId) {
      logger.warn("sendAdminMessage no live session", { traceId, liveClassId });
      return failure(res, "No live session for this liveClassId.", 404);
    }
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) { logger.warn("sendAdminMessage empty message", { traceId, liveClassId }); return failure(res, "Message cannot be empty.", 422); }
    if (text.length > 2000) { logger.warn("sendAdminMessage too long", { traceId, liveClassId, length: text.length }); return failure(res, "Message too long (max 2000 characters).", 422); }

    const admin = req.user as any;
    // The admin JWT only carries { id, email, role } — no name. Look up the
    // admin's real name from ws_users so the FE shows a person, not an email.
    // If there's no name on record, fall back to "Super Admin" (never the email).
    let dbName = "";
    try {
      const adminIdBig = BigInt(String(admin.id));
      const row = await adminAuthRepository.findById(adminIdBig);
      dbName = [row?.firstName, row?.lastName].filter(Boolean).join(" ").trim();
    } catch (e) {
      logger.warn("sendAdminMessage: admin name lookup failed", { traceId, adminId: admin?.id, error: getErrorMessage(e) });
    }
    const adminName = dbName || "Super Admin";

    const saved = await liveSql.sendAdminChatMessage({ liveClassId, adminId: liveSql.parseLiveId(String(admin.id)), userName: adminName, message: text });
    // `role` lets the FE reliably detect a super admin (vs admin/editor) and
    // style the message accordingly — see getChatHistory for the reload path.
    const payload = { _id: saved._id, liveClassId, adminId: admin.id, isAdmin: true, role: admin?.role ?? "admin", userName: adminName, message: text, createdAt: saved.createdAt };

    io?.to(roomKey(liveClassId)).emit("new_message", payload);

    logger.info("sendAdminMessage success", { traceId, liveClassId, adminId: admin.id, messageId: payload._id });
    return success(res, { message: payload }, "Message sent.", 201);
  } catch (err) {
    logger.error("sendAdminMessage failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to send message.", 500);
  }
};

// GET /api/v1/admin/live-chat/:liveClassId/settings
// Returns the per-session chat settings { chatEnabled, privateChat }; defaults
// to { chatEnabled: true, privateChat: false } when nothing has been saved.
export const getChatSettings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveClassId = String(req.params.liveClassId ?? "");
  logger.info("getChatSettings invoked", { traceId, path: req.originalUrl, liveClassId, userId: req.user?.id });

  try {
    if (!liveClassId.trim()) return failure(res, "liveClassId is required.", 422);
    const settings = await liveSql.getChatSettings(liveClassId);
    return success(res, { settings }, "Chat settings fetched.");
  } catch (err) {
    logger.error("getChatSettings failed", { traceId, liveClassId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch chat settings.", 500);
  }
};

// PATCH /api/v1/admin/live-chat/:liveClassId/settings
// Body: { chatEnabled?: boolean, privateChat?: boolean } (partial). Persists,
// broadcasts `chat_settings` to the room so viewers + admins react live, and
// returns the full updated object.
export const updateChatSettings = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveClassId = String(req.params.liveClassId ?? "");
  logger.info("updateChatSettings invoked", { traceId, path: req.originalUrl, liveClassId, body: req.body, userId: req.user?.id });

  try {
    if (!liveClassId.trim()) return failure(res, "liveClassId is required.", 422);

    const patch: { chatEnabled?: boolean; privateChat?: boolean } = {};
    if (req.body?.chatEnabled !== undefined) {
      if (typeof req.body.chatEnabled !== "boolean") return failure(res, "chatEnabled must be a boolean.", 422);
      patch.chatEnabled = req.body.chatEnabled;
    }
    if (req.body?.privateChat !== undefined) {
      if (typeof req.body.privateChat !== "boolean") return failure(res, "privateChat must be a boolean.", 422);
      patch.privateChat = req.body.privateChat;
    }
    if (patch.chatEnabled === undefined && patch.privateChat === undefined) {
      return failure(res, "Provide chatEnabled and/or privateChat to update.", 422);
    }

    const settings = await liveSql.updateChatSettings(liveClassId, patch);
    // Broadcast so the admin panel + every viewer in the room hydrate live.
    io?.to(roomKey(liveClassId)).emit("chat_settings", settings);

    logger.info("updateChatSettings success", { traceId, liveClassId, settings });
    return success(res, { settings }, "Chat settings updated.");
  } catch (err) {
    logger.error("updateChatSettings failed", { traceId, liveClassId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update chat settings.", 500);
  }
};

// GET /api/v1/admin/live-chat/:liveClassId/history
export const getChatHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { liveClassId } = req.params;
  logger.info("getChatHistory invoked", { traceId, path: req.originalUrl, liveClassId, userId: req.user?.id });

  try {
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 50);
    const before = req.query.before ? new Date(req.query.before as string) : undefined;

    // NOTE: includeDeleted not supported on SQL (history excludes soft-deleted).
    const messages = await liveSql.getChatHistory(String(liveClassId), limit, before && !isNaN(before.getTime()) ? before : undefined);
    return success(res, { messages, total: messages.length }, "Chat history fetched.");
  } catch (err) {
    logger.error("getChatHistory failed", { traceId, liveClassId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch chat history.", 500);
  }
};

// DELETE /api/v1/admin/live-chat/messages/:messageId
// Soft-delete one chat message. Broadcasts `message_deleted` so every viewer
// in the room removes it from their UI immediately.
export const deleteChatMessage = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const messageId = String(req.params.messageId ?? "");
  logger.info("deleteChatMessage invoked", { traceId, messageId, userId: req.user?.id });

  try {
    const admin = req.user as any;
    const mid = liveSql.parseLiveId(messageId);
    if (!mid) return failure(res, "Invalid messageId.", 422);
    const r = await liveSql.deleteChatMessage(mid, liveSql.parseLiveId(String(admin.id)));
    if (r === "not_found") return failure(res, "Message not found.", 404);
    if (r === "already") return success(res, { messageId, alreadyDeleted: true }, "Message already deleted.");
    io?.to(roomKey(r.liveClassId)).emit("message_deleted", { messageId, liveClassId: r.liveClassId, deletedAt: r.deletedAt });
    return success(res, { messageId, liveClassId: r.liveClassId, deletedAt: r.deletedAt }, "Message deleted.");
  } catch (err) {
    logger.error("deleteChatMessage failed", { traceId, messageId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete message.", 500);
  }
};

// POST /api/v1/admin/live-chat/bans
// Body: { customerId, reason? }
// Bans a customer from sending any live-chat messages, globally. Disconnects
// every active chat socket the customer has and emits `chat_banned` so their
// UI can show the ban state without polling.
export const banCustomerFromChat = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("banCustomerFromChat invoked", { traceId, body: req.body, userId: req.user?.id });

  try {
    const customerId = String(req.body?.customerId ?? "");
    const reason =
      typeof req.body?.reason === "string" && req.body.reason.trim()
        ? req.body.reason.trim().slice(0, 500)
        : null;

    const admin = req.user as any;
    const cid = liveSql.parseLiveId(customerId);
    if (!cid) return failure(res, "Invalid customerId.", 422);
    // Global ban (no liveClassId scope on the admin path) → "" sentinel.
    const r = await liveSql.banCustomerFromChat("", cid, liveSql.parseLiveId(String(admin.id)), reason);
    const ban = r === "already" ? { _id: null, customerId, reason, createdAt: null } : r;
    disconnectChatSocketsForCustomer(customerId, { reason: reason ?? undefined });
    return success(res, { ban }, "Customer banned from live chat.");
  } catch (err) {
    logger.error("banCustomerFromChat failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to ban customer.", 500);
  }
};

// DELETE /api/v1/admin/live-chat/bans/:customerId
export const unbanCustomerFromChat = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const customerId = String(req.params.customerId ?? "");
  logger.info("unbanCustomerFromChat invoked", { traceId, customerId, userId: req.user?.id });

  try {
    const cid = liveSql.parseLiveId(customerId);
    if (!cid) return failure(res, "Invalid customerId.", 422);
    const removed = await liveSql.unbanCustomerFromChat(cid);
    if (!removed) return success(res, { customerId, alreadyUnbanned: true }, "Customer was not banned.");
    await emitChatUnbannedForCustomer(customerId);
    return success(res, { customerId }, "Customer unbanned.");
  } catch (err) {
    logger.error("unbanCustomerFromChat failed", { traceId, customerId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to unban customer.", 500);
  }
};

// GET /api/v1/admin/live-chat/bans
export const listChatBans = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("listChatBans invoked", { traceId, userId: req.user?.id });

  try {
    const page = Math.max(1, parseInt((req.query.page as string) || "1", 10) || 1);
    const limit = Math.min(100, parseInt((req.query.limit as string) || "20", 10) || 20);

    const all = await liveSql.listChatBans();
    const total = all.length;
    const items = all.slice((page - 1) * limit, (page - 1) * limit + limit);
    return success(res, { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } }, "Chat bans fetched.");
  } catch (err) {
    logger.error("listChatBans failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch chat bans.", 500);
  }
};
