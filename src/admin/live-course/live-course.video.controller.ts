import { Request, Response } from "express";
import mongoose, { Types } from "mongoose";
import { z } from "zod";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { LiveSession } from "../../models/course/LiveSession.model";
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
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    const folderId = String(req.params.folderId ?? "");
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      return failure(res, "Folder not found in this live course.", 404);
    }

    const videos = await Video.find({ videoCategoryId: folderId })
      .sort({ order: 1, createdAt: 1 })
      .lean();
    return success(res, { videos, total: videos.length }, "Videos fetched.");
  } catch (err) {
    logger.error("LiveCourse listVideosInFolder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list videos.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos
// Add a manual video — youtube link, vimeo id, or any URL via the "aws" channel.
export const createVideoInFolder = async (req: Request, res: Response) => {
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    const folderId = String(req.params.folderId ?? "");
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof createVideoSchema>;
    try {
      validated = createVideoSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const video = await Video.create({
      ...validated,
      videoCategoryId: new Types.ObjectId(folderId),
      priceType: validated.priceType ?? "paid",
      order:  validated.order  ?? 0,
      status: validated.status ?? true,
    });

    return success(res, { video: video.toObject() }, "Video added.", 201);
  } catch (err) {
    logger.error("LiveCourse createVideoInFolder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to add video.", 500);
  }
};

// POST /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/from-recording
// Promote a Streamos recording from a LiveSession into a Video record in this
// folder. Picks by recordingIndex (default 0) or quality. The recording URL is
// stored on the Video as `aws_id` with `platform="aws"` — the frontend just
// receives a playable URL.
export const createVideoFromRecording = async (req: Request, res: Response) => {
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    const folderId = String(req.params.folderId ?? "");
    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      return failure(res, "Folder not found in this live course.", 404);
    }

    let validated: z.infer<typeof fromRecordingSchema>;
    try {
      validated = fromRecordingSchema.parse(req.body);
    } catch (err) {
      if (err instanceof z.ZodError) return zodIssueResponse(res, err);
      throw err;
    }

    const liveSession = await LiveSession.findById(validated.liveSessionId).lean();
    if (!liveSession) return failure(res, "Live session not found.", 404);
    if (!liveSession.recordings || liveSession.recordings.length === 0) {
      return failure(res, "Live session has no recordings yet.", 409);
    }

    let picked = liveSession.recordings[validated.recordingIndex ?? 0];
    if (validated.quality) {
      const match = liveSession.recordings.find(
        (r) => r.quality?.toLowerCase() === validated.quality!.toLowerCase()
      );
      if (!match) return failure(res, `No recording with quality "${validated.quality}".`, 404);
      picked = match;
    }
    if (!picked?.path) return failure(res, "Recording has no playable path.", 422);

    const video = await Video.create({
      videoCategoryId: new Types.ObjectId(folderId),
      title: validated.title ?? `${liveSession.title} (${picked.quality ?? "recorded"})`,
      platform: "aws",
      aws_id: picked.path,
      priceType: validated.priceType ?? "paid",
      order: validated.order ?? 0,
      status: true,
    });

    logger.info("LiveCourse: video added from recording", {
      liveCourseId,
      folderId,
      liveSessionId: validated.liveSessionId,
      quality: picked.quality,
      videoId: video._id,
    });

    return success(res, { video: video.toObject() }, "Video added from recording.", 201);
  } catch (err) {
    logger.error("LiveCourse createVideoFromRecording failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to add video from recording.", 500);
  }
};

// DELETE /api/v1/admin/live-courses/:liveCourseId/folders/:folderId/videos/:videoId
export const deleteVideoInFolder = async (req: Request, res: Response) => {
  try {
    const liveCourseId = String(req.params.liveCourseId ?? "");
    const folderId = String(req.params.folderId ?? "");
    const videoId = String(req.params.videoId ?? "");

    if (!(await assertFolderBelongsToCourse(folderId, liveCourseId))) {
      return failure(res, "Folder not found in this live course.", 404);
    }
    if (!mongoose.Types.ObjectId.isValid(videoId)) {
      return failure(res, "Invalid video id.", 422);
    }

    const result = await Video.deleteOne({ _id: videoId, videoCategoryId: folderId });
    if (result.deletedCount === 0) {
      return failure(res, "Video not found in this folder.", 404);
    }

    return success(res, { id: videoId }, "Video deleted.");
  } catch (err) {
    logger.error("LiveCourse deleteVideoInFolder failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to delete video.", 500);
  }
};
