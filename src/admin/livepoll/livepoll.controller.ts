import { Request, Response } from "express";
import { Types } from "mongoose";
import { LivePoll } from "../../models/course/LivePoll.model";
import { LivePollVote } from "../../models/course/LivePollVote.model";
import { io, roomKey } from "../../socket/livechat.socket";
import { resolveLiveClassId } from "../live/live.guards";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// POST /api/v1/admin/live-polls
export const createPoll = async (req: Request, res: Response) => {
  try {
    const { liveClassId, question, options } = req.body;

    const streamId = await resolveLiveClassId(liveClassId);
    if (!streamId) {
      return failure(res, "No live session for this liveClassId.", 404);
    }
    if (!question || typeof question !== "string" || question.trim().length === 0) {
      return failure(res, "question is required.", 422);
    }
    if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
      return failure(res, "Provide between 2 and 6 options.", 422);
    }
    const optionTexts = options.map((o: any) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
    if (optionTexts.length !== options.length) {
      return failure(res, "All options must be non-empty strings.", 422);
    }

    // Close any currently active poll for this class
    const existing = await LivePoll.findOne({ liveClassId, isActive: true });
    if (existing) {
      existing.isActive = false;
      existing.closedAt = new Date();
      await existing.save();
      io?.to(roomKey(liveClassId)).emit("poll_closed", { pollId: existing._id.toString() });
    }

    const adminName: string = (req.user as any)?.firstName
      ? [(req.user as any).firstName, (req.user as any).lastName].filter(Boolean).join(" ")
      : (req.user as any)?.email || "Admin";

    const poll = await LivePoll.create({
      liveClassId,
      question: question.trim(),
      options: optionTexts.map((text) => ({ text, votes: 0 })),
      totalVotes: 0,
      isActive: true,
      createdBy: new Types.ObjectId(req.user!.id),
      createdByName: adminName,
    });

    const pollData = {
      _id: poll._id,
      liveClassId: poll.liveClassId,
      question: poll.question,
      options: poll.options,
      totalVotes: poll.totalVotes,
      createdByName: poll.createdByName,
      createdAt: poll.createdAt,
    };

    // Broadcast to all students in the live class room
    io?.to(roomKey(liveClassId)).emit("poll_created", { poll: pollData });

    logger.info("Live poll: created", { pollId: poll._id, liveClassId, adminId: req.user!.id });
    return success(res, { poll: pollData }, "Poll created and sent to live class.", 201);
  } catch (err) {
    logger.error("Live poll: createPoll failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to create poll.", 500);
  }
};

// PATCH /api/v1/admin/live-polls/:pollId/close
export const closePoll = async (req: Request, res: Response) => {
  try {
    const pollId = req.params.pollId as string;

    if (!Types.ObjectId.isValid(pollId)) {
      return failure(res, "Invalid pollId.", 422);
    }

    const poll = await LivePoll.findById(pollId);
    if (!poll) return failure(res, "Poll not found.", 404);
    if (!poll.isActive) return failure(res, "Poll is already closed.", 400);

    poll.isActive = false;
    poll.closedAt = new Date();
    await poll.save();

    io?.to(roomKey(poll.liveClassId)).emit("poll_closed", { pollId });

    logger.info("Live poll: closed", { pollId, adminId: req.user!.id });
    return success(res, {}, "Poll closed.");
  } catch (err) {
    logger.error("Live poll: closePoll failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to close poll.", 500);
  }
};

// GET /api/v1/admin/live-polls/:liveClassId
export const getPollsByClass = async (req: Request, res: Response) => {
  try {
    const { liveClassId } = req.params;
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);

    const [polls, total] = await Promise.all([
      LivePoll.find({ liveClassId })
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("question options totalVotes isActive createdByName createdAt closedAt")
        .lean(),
      LivePoll.countDocuments({ liveClassId }),
    ]);

    return success(res, { polls, total, page, limit }, "Polls fetched.");
  } catch (err) {
    logger.error("Live poll: getPollsByClass failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch polls.", 500);
  }
};

// PATCH /api/v1/admin/live-polls/:pollId — edit question/options (only when 0 votes)
export const updatePoll = async (req: Request, res: Response) => {
  try {
    const pollId = req.params.pollId as string;

    if (!Types.ObjectId.isValid(pollId)) {
      return failure(res, "Invalid pollId.", 422);
    }

    const poll = await LivePoll.findById(pollId);
    if (!poll) return failure(res, "Poll not found.", 404);
    if (!poll.isActive) return failure(res, "Cannot edit a closed poll.", 400);
    if (poll.totalVotes > 0) return failure(res, "Cannot edit a poll that already has votes.", 400);

    const { question, options } = req.body;
    let changed = false;

    if (question !== undefined) {
      if (typeof question !== "string" || question.trim().length === 0) {
        return failure(res, "question must be a non-empty string.", 422);
      }
      poll.question = question.trim();
      changed = true;
    }

    if (options !== undefined) {
      if (!Array.isArray(options) || options.length < 2 || options.length > 6) {
        return failure(res, "Provide between 2 and 6 options.", 422);
      }
      const optionTexts = options.map((o: any) => (typeof o === "string" ? o.trim() : "")).filter(Boolean);
      if (optionTexts.length !== options.length) {
        return failure(res, "All options must be non-empty strings.", 422);
      }
      poll.options = optionTexts.map((text) => ({ text, votes: 0 }));
      changed = true;
    }

    if (!changed) return failure(res, "Provide question or options to update.", 422);

    await poll.save();

    const pollData = {
      _id: poll._id,
      liveClassId: poll.liveClassId,
      question: poll.question,
      options: poll.options,
      totalVotes: poll.totalVotes,
      createdByName: poll.createdByName,
      createdAt: poll.createdAt,
    };

    // Broadcast updated poll to all students — they re-render the poll card
    io?.to(roomKey(poll.liveClassId)).emit("poll_updated", { poll: pollData });

    logger.info("Live poll: updated", { pollId, adminId: req.user!.id });
    return success(res, { poll: pollData }, "Poll updated.");
  } catch (err) {
    logger.error("Live poll: updatePoll failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to update poll.", 500);
  }
};

// DELETE /api/v1/admin/live-polls/:pollId
export const deletePoll = async (req: Request, res: Response) => {
  try {
    const pollId = req.params.pollId as string;

    if (!Types.ObjectId.isValid(pollId)) {
      return failure(res, "Invalid pollId.", 422);
    }

    const poll = await LivePoll.findById(pollId);
    if (!poll) return failure(res, "Poll not found.", 404);

    const { liveClassId } = poll;

    // Delete poll and all its votes together
    await Promise.all([
      LivePoll.deleteOne({ _id: poll._id }),
      LivePollVote.deleteMany({ pollId: poll._id }),
    ]);

    // Tell students to dismiss the poll card
    io?.to(roomKey(liveClassId)).emit("poll_deleted", { pollId });

    logger.info("Live poll: deleted", { pollId, liveClassId, adminId: req.user!.id });
    return success(res, {}, "Poll deleted.");
  } catch (err) {
    logger.error("Live poll: deletePoll failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to delete poll.", 500);
  }
};

// GET /api/v1/admin/live-polls/:pollId/results
export const getPollResults = async (req: Request, res: Response) => {
  try {
    const pollId = req.params.pollId as string;

    if (!Types.ObjectId.isValid(pollId)) {
      return failure(res, "Invalid pollId.", 422);
    }

    const poll = await LivePoll.findById(pollId)
      .select("question options totalVotes isActive createdByName createdAt closedAt liveClassId")
      .lean();
    if (!poll) return failure(res, "Poll not found.", 404);

    const voterCount = await LivePollVote.countDocuments({ pollId: new Types.ObjectId(pollId) });

    return success(res, { poll, voterCount }, "Poll results fetched.");
  } catch (err) {
    logger.error("Live poll: getPollResults failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch poll results.", 500);
  }
};
