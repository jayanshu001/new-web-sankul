import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { LiveChatMessage } from "../../models/course/LiveChatMessage.model";
import { LiveChatBan } from "../../models/course/LiveChatBan.model";
import { Customer } from "../../models/customer/Customer.model";
import { io, roomKey, disconnectChatSocketsForCustomer, emitChatUnbannedForCustomer } from "../../socket/livechat.socket";
import { resolveLiveClassId } from "../live/live.guards";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

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
    const adminName = [admin?.firstName, admin?.lastName].filter(Boolean).join(" ") || admin?.email || "Admin";

    const saved = await LiveChatMessage.create({
      liveClassId,
      adminId: new Types.ObjectId(admin.id),
      isAdmin: true,
      userName: adminName,
      message: text,
    });

    const payload = {
      _id: saved._id,
      liveClassId,
      adminId: admin.id,
      isAdmin: true,
      userName: adminName,
      message: text,
      createdAt: saved.createdAt,
    };

    io?.to(roomKey(liveClassId)).emit("new_message", payload);

    logger.info("sendAdminMessage success", { traceId, liveClassId, adminId: admin.id, messageId: saved._id });
    return success(res, { message: payload }, "Message sent.", 201);
  } catch (err) {
    logger.error("sendAdminMessage failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to send message.", 500);
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

    const includeDeleted = req.query.includeDeleted === "true";
    const query: any = { liveClassId };
    if (!includeDeleted) query.deletedAt = null;
    if (before && !isNaN(before.getTime())) query.createdAt = { $lt: before };

    const messages = await LiveChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("customerId adminId isAdmin userName message createdAt deletedAt deletedBy")
      .lean();

    logger.info("getChatHistory success", { traceId, liveClassId, count: messages.length });
    return success(res, { messages: messages.reverse(), total: messages.length }, "Chat history fetched.");
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
    if (!mongoose.Types.ObjectId.isValid(messageId)) {
      return failure(res, "Invalid messageId.", 422);
    }

    const admin = req.user as any;
    const msg = await LiveChatMessage.findById(messageId);
    if (!msg) return failure(res, "Message not found.", 404);
    if (msg.deletedAt) {
      return success(res, { messageId, alreadyDeleted: true }, "Message already deleted.");
    }

    msg.deletedAt = new Date();
    msg.deletedBy = new Types.ObjectId(admin.id);
    await msg.save();

    io?.to(roomKey(msg.liveClassId)).emit("message_deleted", {
      messageId: String(msg._id),
      liveClassId: msg.liveClassId,
      deletedAt: msg.deletedAt,
    });

    logger.info("deleteChatMessage success", { traceId, messageId, liveClassId: msg.liveClassId });
    return success(res, { messageId, liveClassId: msg.liveClassId, deletedAt: msg.deletedAt }, "Message deleted.");
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

    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return failure(res, "Invalid customerId.", 422);
    }
    const customer = await Customer.findById(customerId).select("_id firstName lastName phoneNumber").lean();
    if (!customer) return failure(res, "Customer not found.", 404);

    const admin = req.user as any;
    const ban = await LiveChatBan.findOneAndUpdate(
      { customerId },
      {
        $setOnInsert: {
          customerId: new Types.ObjectId(customerId),
          bannedBy: new Types.ObjectId(admin.id),
          reason,
        },
      },
      { new: true, upsert: true }
    );

    // Real-time enforcement: drop the user's chat sockets, tell their client.
    disconnectChatSocketsForCustomer(customerId, { reason: reason ?? undefined });

    logger.info("banCustomerFromChat success", { traceId, customerId, banId: String(ban._id) });
    return success(
      res,
      { ban: { _id: ban._id, customerId, reason: ban.reason, createdAt: ban.createdAt } },
      "Customer banned from live chat."
    );
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
    if (!mongoose.Types.ObjectId.isValid(customerId)) {
      return failure(res, "Invalid customerId.", 422);
    }
    const result = await LiveChatBan.deleteOne({ customerId });
    if (result.deletedCount === 0) {
      return success(res, { customerId, alreadyUnbanned: true }, "Customer was not banned.");
    }

    // Real-time: tell any live sockets this customer has so their UI re-enables
    // chat input without a refresh.
    await emitChatUnbannedForCustomer(customerId);

    logger.info("unbanCustomerFromChat success", { traceId, customerId });
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

    const [rows, total] = await Promise.all([
      LiveChatBan.find({})
        .populate({ path: "customerId", select: "_id firstName lastName phoneNumber" })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .lean(),
      LiveChatBan.countDocuments({}),
    ]);

    return success(
      res,
      {
        items: rows,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
      "Chat bans fetched."
    );
  } catch (err) {
    logger.error("listChatBans failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch chat bans.", 500);
  }
};
