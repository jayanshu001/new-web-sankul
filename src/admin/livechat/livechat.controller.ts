import { Request, Response } from "express";
import { Types } from "mongoose";
import { LiveChatMessage } from "../../models/course/LiveChatMessage.model";
import { io, roomKey } from "../../socket/livechat.socket";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// POST /api/v1/admin/live-chat/message
export const sendAdminMessage = async (req: Request, res: Response) => {
  try {
    const { liveClassId, message } = req.body;

    if (!liveClassId || typeof liveClassId !== "string") {
      return failure(res, "liveClassId is required.", 422);
    }
    const text = typeof message === "string" ? message.trim() : "";
    if (!text) return failure(res, "Message cannot be empty.", 422);
    if (text.length > 2000) return failure(res, "Message too long (max 2000 characters).", 422);

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

    logger.info("Live chat: admin message sent", { liveClassId, adminId: admin.id });
    return success(res, { message: payload }, "Message sent.", 201);
  } catch (err) {
    logger.error("Live chat: admin sendMessage failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to send message.", 500);
  }
};

// GET /api/v1/admin/live-chat/:liveClassId/history
export const getChatHistory = async (req: Request, res: Response) => {
  try {
    const { liveClassId } = req.params;
    const limit  = Math.min(100, parseInt(req.query.limit as string) || 50);
    const before = req.query.before ? new Date(req.query.before as string) : undefined;

    const query: any = { liveClassId };
    if (before && !isNaN(before.getTime())) query.createdAt = { $lt: before };

    const messages = await LiveChatMessage.find(query)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("customerId adminId isAdmin userName message createdAt")
      .lean();

    return success(res, { messages: messages.reverse(), total: messages.length }, "Chat history fetched.");
  } catch (err) {
    logger.error("Live chat: admin getChatHistory failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch chat history.", 500);
  }
};
