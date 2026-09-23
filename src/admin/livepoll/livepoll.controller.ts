import { Request, Response } from "express";
import { io, roomKey } from "../../socket/livechat.socket";
import { resolveLiveClassId } from "../live/live.guards";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import * as liveSql from "../../modules/admin-live-course/admin-live-course.service";

// POST /api/v1/admin/live-polls
export const createPoll = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  logger.info("createPoll invoked", { traceId, path: req.originalUrl, userId: req.user?.id });

  try {
    const { liveClassId, question, options } = req.body;

    const streamId = await resolveLiveClassId(liveClassId);
    if (!streamId) {
      logger.warn("createPoll no live session", { traceId, liveClassId });
      return failure(res, "No live session for this liveClassId.", 404);
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      logger.warn("createPoll missing question", { traceId, liveClassId });
      return failure(res, "question is required.", 422);
    }
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      logger.warn("createPoll bad options count", { traceId, liveClassId });
      return failure(res, "Provide between 2 and 6 options.", 422);
    }
    const optionTexts = options.map((o: any) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
    if (optionTexts.length !== options.length) {
      logger.warn("createPoll empty option", { traceId, liveClassId });
      return failure(res, "All options must be non-empty strings.", 422);
    }

    const adminName: string = (req.user as any)?.firstName
      ? [(req.user as any).firstName, (req.user as any).lastName].filter(Boolean).join(" ")
      : (req.user as any)?.email || "Admin";

    const { poll: created, closedPollId } = await liveSql.createPoll({ liveClassId, question: question.trim(), options: optionTexts, createdBy: liveSql.parseLiveId(String(req.user!.id)), createdByName: adminName });
    if (closedPollId) io?.to(roomKey(liveClassId)).emit("poll_closed", { pollId: closedPollId });
    const pollData = { _id: created._id, liveClassId: created.liveClassId, question: created.question, options: created.options, totalVotes: created.totalVotes, isActive: true, createdByName: created.createdByName, createdAt: created.createdAt };
    io?.to(roomKey(liveClassId)).emit("poll_created", { poll: pollData });
    return success(res, { poll: pollData }, "Poll created and sent to live class.", 201);
  } catch (err) {
    logger.error("createPoll failed", { traceId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to create poll.", 500);
  }
};

// PATCH /api/v1/admin/live-polls/:pollId/close
export const closePoll = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const pollId = req.params.pollId as string;
  logger.info("closePoll invoked", { traceId, path: req.originalUrl, pollId, userId: req.user?.id });

  try {
    const pid = liveSql.parseLiveId(pollId);
    if (!pid) return failure(res, "Invalid pollId.", 422);
    const r = await liveSql.closePoll(pid);
    if (r === "not_found") return failure(res, "Poll not found.", 404);
    io?.to(roomKey(r.liveClassId)).emit("poll_closed", { pollId });
    return success(res, {}, "Poll closed.");
  } catch (err) {
    logger.error("closePoll failed", { traceId, pollId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to close poll.", 500);
  }
};

// GET /api/v1/admin/live-polls/:liveClassId
export const getPollsByClass = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const { liveClassId } = req.params;
  logger.info("getPollsByClass invoked", { traceId, path: req.originalUrl, liveClassId, userId: req.user?.id });

  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const all = await liveSql.getPollsByClass(String(liveClassId));
    const total = all.length;
    const polls = all.slice((page - 1) * limit, (page - 1) * limit + limit);
    return success(res, { polls, total, page, limit }, "Polls fetched.");
  } catch (err) {
    logger.error("getPollsByClass failed", { traceId, liveClassId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch polls.", 500);
  }
};

// PATCH /api/v1/admin/live-polls/:pollId — edit question/options (only when 0 votes)
export const updatePoll = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const pollId = req.params.pollId as string;
  logger.info("updatePoll invoked", { traceId, path: req.originalUrl, pollId, userId: req.user?.id });

  try {
    const pid = liveSql.parseLiveId(pollId);
    if (!pid) {
      logger.warn("updatePoll invalid id", { traceId, pollId });
      return failure(res, "Invalid pollId.", 422);
    }

    const { question, options } = req.body;
    const patch: { question?: string; options?: string[] } = {};

    if (question !== undefined) {
      if (typeof question !== "string" || question.trim().length === 0) {
        logger.warn("updatePoll invalid question", { traceId, pollId });
        return failure(res, "question must be a non-empty string.", 422);
      }
      patch.question = question.trim();
    }

    if (options !== undefined) {
      if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
        logger.warn("updatePoll bad options count", { traceId, pollId });
        return failure(res, "Provide between 2 and 6 options.", 422);
      }
      const optionTexts = options.map((o: any) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
      if (optionTexts.length !== options.length) {
        logger.warn("updatePoll empty option", { traceId, pollId });
        return failure(res, "All options must be non-empty strings.", 422);
      }
      patch.options = optionTexts;
    }

    if (patch.question === undefined && patch.options === undefined) {
      logger.warn("updatePoll no fields", { traceId, pollId });
      return failure(res, "Provide question or options to update.", 422);
    }

    const result = await liveSql.updatePollWithOptions(pid, patch);
    if (result === "not_found") { logger.warn("updatePoll not found", { traceId, pollId }); return failure(res, "Poll not found.", 404); }
    if (result === "closed") { logger.warn("updatePoll already closed", { traceId, pollId }); return failure(res, "Cannot edit a closed poll.", 400); }
    if (result === "has_votes") { logger.warn("updatePoll has votes", { traceId, pollId }); return failure(res, "Cannot edit a poll that already has votes.", 400); }

    const pollData = {
      _id: result._id,
      liveClassId: result.liveClassId,
      question: result.question,
      options: result.options,
      totalVotes: result.totalVotes,
      isActive: true,
      createdByName: result.createdByName,
      createdAt: result.createdAt,
    };

    // Broadcast updated poll to all students — they re-render the poll card
    io?.to(roomKey(result.liveClassId)).emit("poll_updated", { poll: pollData });

    logger.info("updatePoll success", { traceId, pollId, adminId: req.user!.id });
    return success(res, { poll: pollData }, "Poll updated.");
  } catch (err) {
    logger.error("updatePoll failed", { traceId, pollId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update poll.", 500);
  }
};

// DELETE /api/v1/admin/live-polls/:pollId
export const deletePoll = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const pollId = req.params.pollId as string;
  logger.info("deletePoll invoked", { traceId, path: req.originalUrl, pollId, userId: req.user?.id });

  try {
    const pid = liveSql.parseLiveId(pollId);
    if (!pid) return failure(res, "Invalid pollId.", 422);
    const poll = await liveSql.getPollResults(pid);
    if (poll === "not_found") return failure(res, "Poll not found.", 404);
    await liveSql.deletePoll(pid);
    io?.to(roomKey(poll.liveClassId)).emit("poll_deleted", { pollId });
    return success(res, {}, "Poll deleted.");
  } catch (err) {
    logger.error("deletePoll failed", { traceId, pollId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete poll.", 500);
  }
};

// GET /api/v1/admin/live-polls/:pollId/results
export const getPollResults = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const pollId = req.params.pollId as string;
  logger.info("getPollResults invoked", { traceId, path: req.originalUrl, pollId, userId: req.user?.id });

  try {
    const pid = liveSql.parseLiveId(pollId);
    if (!pid) return failure(res, "Invalid pollId.", 422);
    const poll = await liveSql.getPollResults(pid);
    if (poll === "not_found") return failure(res, "Poll not found.", 404);
    // voterCount = sum of option votes (votes table may be sparse on staging).
    const voterCount = poll.options.reduce((s: number, o: any) => s + (o.votes || 0), 0);
    return success(res, { poll, voterCount }, "Poll results fetched.");
  } catch (err) {
    logger.error("getPollResults failed", { traceId, pollId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch poll results.", 500);
  }
};
