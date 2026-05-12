import { Request, Response } from "express";
import { LiveChatMessage } from "../../models/course/LiveChatMessage.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

export const getChatHistory = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const { liveClassId } = req.params;
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before as string | undefined;

  try {
    if (!userId) return failure(res, "Unauthorized", 401);
    if (!liveClassId) return failure(res, "liveClassId is required", 400);

    const filter: Record<string, any> = { liveClassId };
    if (before) filter.createdAt = { $lt: new Date(before) };

    const messages = await LiveChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("customerId userName message createdAt")
      .lean();

    return success(res, { messages: messages.reverse() }, "Chat history fetched", 200);
  } catch (err) {
    logger.error("getChatHistory failed", { liveClassId, userId, error: getErrorMessage(err) });
    return failure(res, getErrorMessage(err), 500);
  }
};
