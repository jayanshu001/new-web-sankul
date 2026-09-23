import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

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

    // Which listing to return. `?private=true|false` is explicit; omitted follows
    // whatever mode the host has the class in right now, so a client that just
    // asks for "the history" never gets the other mode's thread mixed in.
    const priv = req.query.private;
    const isPrivate =
      priv === undefined
        ? (await liveSql.getChatSettings(String(liveClassId))).privateChat
        : priv === "true" || priv === "1";

    // A viewer sees their own private messages plus host replies addressed to
    // them — never another student's thread. The public listing is the same for
    // everyone, so it carries no viewer scope.
    const viewerId = isPrivate ? liveSql.parseLiveId(String(userId)) : null;
    if (isPrivate && viewerId == null) return success(res, { messages: [], privateChat: true }, "Chat history fetched", 200);

    const messages = await liveSql.getChatHistory(
      String(liveClassId),
      limit,
      before ? new Date(before) : undefined,
      { isPrivate, viewerId }
    );
    return success(res, { messages, privateChat: isPrivate }, "Chat history fetched", 200);
  } catch (err) {
    logger.error("getChatHistory failed", { traceId, liveClassId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

export const getChatBanStatus = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("getChatBanStatus invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) { logger.warn("getChatBanStatus unauthorized", { traceId }); return failure(res, "Unauthorized", 401); }

    const cid = liveSql.parseLiveId(String(userId));
    const payload = cid ? await liveSql.getChatBanStatus(cid) : { isBanned: false, reason: null, bannedAt: null };
    return success(res, payload, "Chat ban status fetched", 200);
  } catch (err) {
    logger.error("getChatBanStatus failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
