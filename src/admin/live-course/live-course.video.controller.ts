import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { resolveRecording, promoteRecordingToFolder } from "../live/recording.promote";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid ObjectId");

const createVideoSchema = z
  .object({
    title:     z.string().trim().min(1, "Title is required").max(500),
    topic:     z.string().trim().max(500).optional(),
    platform:  z.enum(["youtube", "aws", "vimeo"]),
    priceType: z.enum(["free", "paid"]).optional(),
    youtube_id: z.string().trim().optional(),
    aws_id:     z.string().trim().optional(),
    vimeo_id:   z.string().trim().optional(),
    order:      z.number().int().optional(),
    status:     z.boolean().optional(),
  })
  .strict()
  .refine(
    (v) =>
      (v.platform === "youtube" && !!v.youtube_id) ||
      (v.platform === "aws"     && !!v.aws_id) ||
      (v.platform === "vimeo"   && !!v.vimeo_id),
    { message: "Provide the id field matching the selected platform.", path: ["platform"] }
  );

const fromRecordingSchema = z
  .object({
    liveSessionId: objectId,
    // 0-based index into LiveSession.recordings, or omit to pick the first.
    recordingIndex: z.number().int().nonnegative().optional(),
    // Convenience: pick by quality ("720p", "480p" etc.) if the index is unknown.
    quality: z.string().trim().optional(),
    title:   z.string().trim().min(1).max(500).optional(),
    priceType: z.enum(["free", "paid"]).optional(),
    order:     z.number().int().optional(),
  })
  .strict();

// PATCH/PUT — every field optional. No cross-field platform/id refinement here:
// editing just the title or order is the common case, and the admin UI owns
// keeping platform + its id field consistent.
const updateVideoSchema = z
  .object({
    title:      z.string().trim().min(1).max(500).optional(),
    topic:      z.string().trim().max(500).optional(),
    platform:   z.enum(["youtube", "aws", "vimeo"]).optional(),
    priceType:  z.enum(["free", "paid"]).optional(),
    youtube_id: z.string().trim().optional(),
    aws_id:     z.string().trim().optional(),
    vimeo_id:   z.string().trim().optional(),
    order:      z.number().int().optional(),
    status:     z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: "Provide at least one field to update." });

const reorderVideosSchema = z
  .object({
    orders: z
      .array(z.object({ id: objectId, order: z.number().int() }))
      .min(1, "orders must contain at least one item"),
  })
  .strict();

function zodIssueResponse(res: Response, err: z.ZodError) {
  const messages = err.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`);
  return failure(res, "Validation failed.", 422, { errors: messages });
}

async function assertFolderBelongsToCourse(folderId: string, liveCourseId: string): Promise<boolean> {
  if (!mongoose.Types.ObjectId.isValid(folderId) || !mongoose.Types.ObjectId.isValid(liveCourseId)) return false;
  const exists = await LiveCourse.exists({ _id: liveCourseId });
  if (!exists) return false;
  return Boolean(await VideoCategory.exists({ _id: folderId, liveCourseId }));
}

// GET /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos
export const listVideosInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("listVideosInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("listVideosInFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }

    const videos = await Video.find({ videoCategoryId: folderId })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    logger.info("listVideosInFolder success", { traceId, liveCourseId, folderId, count: videos.length });
    return success(res, { videos, total: videos.length }, "Videos fetched.");
  } catch (err) {
    logger.error("listVideosInFolder failed", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to list videos.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos
// Add a manual video — youtube link, vimeo id, or any URL via the "aws" channel.
export const createVideoInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("createVideoInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("createVideoInFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof createVideoSchema>;
    try {
      validated = createVideoSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("createVideoInFolder validation failed", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }

    const video = await Video.create({
      ...validated,
      videoCategoryId: new Types.ObjectId(folderId),
      priceType: validated.priceType ?? "paid",
      order:  validated.order  ?? 0,
      status: validated.status ?? true,
    });

    logger.info("createVideoInFolder success", { traceId, liveCourseId, folderId, videoId: video._id });
    return success(res, { video: video.toObject() }, "Video added.", 201);
  } catch (err) {
    logger.error("createVideoInFolder failed", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to add video.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/from-recording
// Promote a Streamos recording from a LiveSession into a Video record in this
// folder. Picks by recordingIndex (default 0) or quality. The recording URL is
// stored on the Video as `aws_id` with `platform="aws"` — the frontend just
// receives a playable URL.
export const createVideoFromRecording = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("createVideoFromRecording invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("createVideoFromRecording folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof fromRecordingSchema>;
    try {
      validated = fromRecordingSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("createVideoFromRecording validation failed", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }

    const liveSession = await LiveSession.findById(validated.liveSessionId);
    if (!liveSession) { logger.warn("createVideoFromRecording session not found", { traceId, liveSessionId: validated.liveSessionId }); return failure(res, "Live session not found.", 404); }
    if (!liveSession.recordings || liveSession.recordings.length === 0) {
      logger.warn("createVideoFromRecording no recordings", { traceId, liveSessionId: validated.liveSessionId });
      return failure(res, "Live session has no recordings yet.", 409);
    }

    const recording = resolveRecording(liveSession, {
      recordingIndex: validated.recordingIndex,
      quality: validated.quality,
    });
    if (!recording) {
      logger.warn("createVideoFromRecording recording not found", { traceId, liveSessionId: validated.liveSessionId, quality: validated.quality, index: validated.recordingIndex });
      return failure(
        res,
        validated.quality
          ? `No recording with quality "${validated.quality}".`
          : "No recording found at that index.",
        404
      );
    }

    // Shared helper: dedupes per folder and stamps the Video with liveSessionId
    // so the recording can be traced back to its source session.
    const { video, alreadyExisted } = await promoteRecordingToFolder({
      session: liveSession,
      recording,
      folderId,
      title: validated.title,
      priceType: validated.priceType,
      order: validated.order,
    });

    logger.info("createVideoFromRecording success", {
      traceId,
      liveCourseId,
      folderId,
      liveSessionId: validated.liveSessionId,
      quality: recording.quality,
      videoId: video._id,
      alreadyExisted,
    });

    return success(
      res,
      { video: video.toObject(), alreadyExisted },
      alreadyExisted
        ? "Recording already present in this folder."
        : "Video added from recording.",
      alreadyExisted ? 200 : 201
    );
  } catch (err) {
    logger.error("createVideoFromRecording failed", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to add video from recording.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
export const deleteVideoInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("deleteVideoInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, videoId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("deleteVideoInFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      logger.warn("deleteVideoInFolder invalid videoId", { traceId, videoId });
      return failure(res, "Invalid video id.", 422);
    }

    const result = await Video.deleteOne({ _id: videoId, videoCategoryId: folderId });
    if (result.deletedCount === 0) {
      logger.warn("deleteVideoInFolder not found", { traceId, videoId, folderId });
      return failure(res, "Video not found in this folder.", 404);
    }

    logger.info("deleteVideoInFolder success", { traceId, videoId, folderId });
    return success(res, { id: videoId }, "Video deleted.");
  } catch (err) {
    logger.error("deleteVideoInFolder failed", { traceId, liveCourseId, folderId, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to delete video.", 500);
  }
};

// GET /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
export const getVideoInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("getVideoInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, videoId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("getVideoInFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      logger.warn("getVideoInFolder invalid videoId", { traceId, videoId });
      return failure(res, "Invalid video id.", 422);
    }

    const video = await Video.findOne({ _id: videoId, videoCategoryId: folderId }).lean();
    if (!video) { logger.warn("getVideoInFolder not found", { traceId, videoId, folderId }); return failure(res, "Video not found in this folder.", 404); }

    logger.info("getVideoInFolder success", { traceId, videoId });
    return success(res, { video }, "Video fetched.");
  } catch (err) {
    logger.error("getVideoInFolder failed", { traceId, liveCourseId, folderId, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to fetch video.", 500);
  }
};

// PUT /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
export const updateVideoInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  const videoId = String(req.params.videoId ?? "");
  logger.info("updateVideoInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, videoId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("updateVideoInFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      logger.warn("updateVideoInFolder invalid videoId", { traceId, videoId });
      return failure(res, "Invalid video id.", 422);
    }

    let validated: z.infer<typeof updateVideoSchema>;
    try {
      validated = updateVideoSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("updateVideoInFolder validation failed", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }

    // Scope the update to this folder so a stray videoId from another folder
    // can't be edited through this course's route.
    const video = await Video.findOneAndUpdate(
      { _id: videoId, videoCategoryId: folderId },
      { $set: validated },
      { new: true, runValidators: true }
    );
    if (!video) { logger.warn("updateVideoInFolder not found", { traceId, videoId, folderId }); return failure(res, "Video not found in this folder.", 404); }

    logger.info("updateVideoInFolder success", { traceId, videoId, folderId });
    return success(res, { video: video.toObject() }, "Video updated.");
  } catch (err) {
    logger.error("updateVideoInFolder failed", { traceId, liveCourseId, folderId, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to update video.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/reorder
// Body: { orders: [{ id, order }] }. Only videos that actually live in this
// folder are touched — ids from elsewhere are silently ignored.
export const reorderVideosInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("reorderVideosInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  try {
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      logger.warn("reorderVideosInFolder folder not found", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof reorderVideosSchema>;
    try {
      validated = reorderVideosSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("reorderVideosInFolder validation failed", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }

    const result = await Video.bulkWrite(
      validated.orders.map(({ id, order }) => ({
        updateOne: {
          filter: { _id: id, videoCategoryId: folderId },
          update: { $set: { order } },
        },
      }))
    );

    logger.info("reorderVideosInFolder success", { traceId, liveCourseId, folderId, matched: result.matchedCount, modified: result.modifiedCount });
    return success(
      res,
      {
        matched: result.matchedCount ?? 0,
        modified: result.modifiedCount ?? 0,
      },
      "Videos reordered."
    );
  } catch (err) {
    logger.error("reorderVideosInFolder failed", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to reorder videos.", 500);
  }
};
