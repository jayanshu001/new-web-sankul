import { Request, Response } from "express";
import { Types } from "mongoose";
import { LivePoll } from "../../models/course/LivePoll.model";
import { LivePollVote } from "../../models/course/LivePollVote.model";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// GET /api/v1/client/live-polls/:liveClassId/active
export const getActivePoll = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { liveClassId } = req.params;
  const userId = req.user?.id;
  logger.info("getActivePoll invoked", { traceId, path: req.originalUrl, userId, liveClassId });

  try {
    const poll = await LivePoll.findOne({ liveClassId, isActive: true })
      .select("question options totalVotes createdAt")
      .lean();

    if (!poll) {
      logger.info("getActivePoll no active poll", { traceId, liveClassId });
      return success(res, { poll: null }, "No active poll.");
    }

    const existingVote = await LivePollVote.findOne({
      pollId: poll._id,
      customerId: new Types.ObjectId(req.user!.id),
    }).lean();

    logger.info("getActivePoll success", { traceId, userId, liveClassId, pollId: poll._id, hasVote: !!existingVote });
    return success(res, { poll, myVote: existingVote ? existingVote.optionIndex : null }, "Active poll fetched.");
  } catch (err) {
    logger.error("getActivePoll failed", { traceId, userId, liveClassId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch active poll.", 500);
  }
};
