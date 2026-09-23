import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

// GET /api/v1/client/live-polls/:liveClassId/active
export const getActivePoll = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { liveClassId } = req.params;
  const userId = req.user?.id;
  logger.info("getActivePoll invoked", { traceId, path: req.originalUrl, userId, liveClassId });

  try {
    const cid = liveSql.parseLiveId(String(userId));
    const r = await liveSql.getActivePoll(String(liveClassId), cid ?? 0);
    return success(res, r.poll ? { poll: r.poll, myVote: r.myVote } : { poll: null }, r.poll ? "Active poll fetched." : "No active poll.");
  } catch (err) {
    logger.error("getActivePoll failed", { traceId, userId, liveClassId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch active poll.", 500);
  }
};
