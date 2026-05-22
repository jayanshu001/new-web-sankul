import { Request, Response } from "express";
import { LiveChatMessage } from "../../models/course/LiveChatMessage.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

export const getChatHistory = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  const { liveClassId } = req.params;
  logger.info("getChatHistory invoked", { traceId, path: req.originalUrl, userId, liveClassId });

  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = req.query.before as string | undefined;

  try {
    if (!userId) { logger.warn("getChatHistory unauthorized", { traceId }); return failure(res, "Unauthorized", 401); }
    if (!liveClassId) { logger.warn("getChatHistory missing liveClassId", { traceId, userId }); return failure(res, "liveClassId is required", 400); }

    const filter: Record<string, any> = { liveClassId, deletedAt: null };
    if (before) filter.createdAt = { $lt: new Date(before) };

    const messages = await LiveChatMessage.find(filter)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select("customerId userName message createdAt")
      .lean();

    logger.info("getChatHistory success", { traceId, userId, liveClassId, count: messages.length });
    return success(res, { messages: messages.reverse() }, "Chat history fetched", 200);
  } catch (err) {
    logger.error("getChatHistory failed", { traceId, liveClassId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};
