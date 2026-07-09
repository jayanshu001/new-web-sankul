import { Request, Response } from "express";
import { z } from "zod";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import logger from "../../utils/logger";
import * as liveCourseSql from "../../modules/admin-live-course/admin-live-course.service";

const objectId = z.string().regex(/^([0-9a-fA-F]{24}|[1-9]\d*)$/, "Invalid ObjectId");

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

// GET /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos
export const listVideosInFolder = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const liveCourseId = String(req.params.liveCourseId ?? "");
  const folderId = String(req.params.folderId ?? "");
  logger.info("listVideosInFolder invoked", { traceId, path: req.originalUrl, liveCourseId, folderId, userId: req.user?.id });

  try {
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("listVideosInFolder folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    const { page, limit, skip } = parseListQuery(req.query, { defaultLimit: 10, maxLimit: 500 });
    const { data, total } = await liveCourseSql.lcListVideosInFolder(fid, { skip, take: limit });
    logger.info("listVideosInFolder success (sql)", { traceId, liveCourseId, folderId, count: data.length, total });
    return res.status(200).json({ success: true, data, pagination: buildPagination(total, page, limit) });
  } catch (err) {
    logger.error("listVideosInFolder failed (sql)", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
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
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("createVideoInFolder folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    let validated: z.infer<typeof createVideoSchema>;
    try {
      validated = createVideoSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("createVideoInFolder validation failed (sql)", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }
    const video = await liveCourseSql.lcCreateVideoInFolder(fid, {
      title: validated.title, topic: validated.topic, platform: validated.platform,
      priceType: validated.priceType, youtube_id: validated.youtube_id, aws_id: validated.aws_id,
      vimeo_id: validated.vimeo_id, order: validated.order, status: validated.status,
    });
    logger.info("createVideoInFolder success (sql)", { traceId, liveCourseId, folderId, videoId: video._id });
    return success(res, { video }, "Video added.", 201);
  } catch (err) {
    logger.error("createVideoInFolder failed (sql)", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
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
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("createVideoFromRecording folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    let validated: z.infer<typeof fromRecordingSchema>;
    try {
      validated = fromRecordingSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("createVideoFromRecording validation failed (sql)", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }
    const sid = liveCourseSql.parseLiveId(validated.liveSessionId);
    if (sid == null) { logger.warn("createVideoFromRecording session not found (sql)", { traceId, liveSessionId: validated.liveSessionId }); return failure(res, "Live session not found.", 404); }
    const result = await liveCourseSql.lcCreateVideoFromRecording(fid, {
      liveSessionId: sid, recordingIndex: validated.recordingIndex, quality: validated.quality,
      title: validated.title, priceType: validated.priceType, order: validated.order,
    });
    if (result === "session_not_found") { logger.warn("createVideoFromRecording session not found (sql)", { traceId, liveSessionId: validated.liveSessionId }); return failure(res, "Live session not found.", 404); }
    if (result === "no_recordings") { logger.warn("createVideoFromRecording no recordings (sql)", { traceId, liveSessionId: validated.liveSessionId }); return failure(res, "Live session has no recordings yet.", 409); }
    if (result === "recording_not_found" || result === "no_path") {
      logger.warn("createVideoFromRecording recording not found (sql)", { traceId, liveSessionId: validated.liveSessionId, quality: validated.quality, index: validated.recordingIndex });
      return failure(res, validated.quality ? `No recording with quality "${validated.quality}".` : "No recording found at that index.", 404);
    }
    logger.info("createVideoFromRecording success (sql)", { traceId, liveCourseId, folderId, liveSessionId: validated.liveSessionId, videoId: result.video._id, alreadyExisted: result.alreadyExisted });
    return success(res, { video: result.video, alreadyExisted: result.alreadyExisted }, result.alreadyExisted ? "Recording already present in this folder." : "Video added from recording.", result.alreadyExisted ? 200 : 201);
  } catch (err) {
    logger.error("createVideoFromRecording failed (sql)", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
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
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("deleteVideoInFolder folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    const vid = liveCourseSql.parseLiveId(videoId);
    if (vid == null) { logger.warn("deleteVideoInFolder invalid videoId (sql)", { traceId, videoId }); return failure(res, "Invalid video id.", 422); }
    const deleted = await liveCourseSql.lcDeleteVideoInFolder(fid, vid);
    if (!deleted) { logger.warn("deleteVideoInFolder not found (sql)", { traceId, videoId, folderId }); return failure(res, "Video not found in this folder.", 404); }
    logger.info("deleteVideoInFolder success (sql)", { traceId, videoId, folderId });
    return success(res, { id: videoId }, "Video deleted.");
  } catch (err) {
    logger.error("deleteVideoInFolder failed (sql)", { traceId, liveCourseId, folderId, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
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
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("getVideoInFolder folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    const vid = liveCourseSql.parseLiveId(videoId);
    if (vid == null) { logger.warn("getVideoInFolder invalid videoId (sql)", { traceId, videoId }); return failure(res, "Invalid video id.", 422); }
    const video = await liveCourseSql.lcGetVideoInFolder(fid, vid);
    if (!video) { logger.warn("getVideoInFolder not found (sql)", { traceId, videoId, folderId }); return failure(res, "Video not found in this folder.", 404); }
    logger.info("getVideoInFolder success (sql)", { traceId, videoId });
    return success(res, { video }, "Video fetched.");
  } catch (err) {
    logger.error("getVideoInFolder failed (sql)", { traceId, liveCourseId, folderId, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
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
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("updateVideoInFolder folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    const vid = liveCourseSql.parseLiveId(videoId);
    if (vid == null) { logger.warn("updateVideoInFolder invalid videoId (sql)", { traceId, videoId }); return failure(res, "Invalid video id.", 422); }
    let validated: z.infer<typeof updateVideoSchema>;
    try {
      validated = updateVideoSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("updateVideoInFolder validation failed (sql)", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }
    const video = await liveCourseSql.lcUpdateVideoInFolder(fid, vid, validated);
    if (!video) { logger.warn("updateVideoInFolder not found (sql)", { traceId, videoId, folderId }); return failure(res, "Video not found in this folder.", 404); }
    logger.info("updateVideoInFolder success (sql)", { traceId, videoId, folderId });
    return success(res, { video }, "Video updated.");
  } catch (err) {
    logger.error("updateVideoInFolder failed (sql)", { traceId, liveCourseId, folderId, videoId, error: getErrorMessage(err), stack: (err as Error).stack });
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
    const cid = liveCourseSql.parseLiveId(liveCourseId);
    const fid = liveCourseSql.parseLiveId(folderId);
    if (cid == null || fid == null || !(await liveCourseSql.lcFolderBelongsToCourse(fid, cid))) {
      logger.warn("reorderVideosInFolder folder not found (sql)", { traceId, liveCourseId, folderId });
      return failure(res, "Folder not found in this live course.", 404);
    }
    let validated: z.infer<typeof reorderVideosSchema>;
    try {
      validated = reorderVideosSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) { logger.warn("reorderVideosInFolder validation failed (sql)", { traceId, issues: err.issues }); return zodIssueResponse(res, err); }
      throw err;
    }
    const orders = validated.orders
      .map((o) => ({ id: liveCourseSql.parseLiveId(o.id), order: o.order }))
      .filter((o): o is { id: number; order: number } => o.id != null);
    const result = await liveCourseSql.lcReorderVideosInFolder(fid, orders);
    logger.info("reorderVideosInFolder success (sql)", { traceId, liveCourseId, folderId, matched: result.matched, modified: result.modified });
    return success(res, { matched: result.matched, modified: result.modified }, "Videos reordered.");
  } catch (err) {
    logger.error("reorderVideosInFolder failed (sql)", { traceId, liveCourseId, folderId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Failed to reorder videos.", 500);
  }
};
