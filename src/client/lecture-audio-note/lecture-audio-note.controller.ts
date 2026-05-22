import { Request, Response } from "express";
import { Types } from "mongoose";
import { LectureAudioNote } from "../../models/customer/LectureAudioNote.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { hasAccessToAnyLiveCourse } from "../live-course/entitlement";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  createAudioNoteBodySchema,
  updateAudioNoteBodySchema,
  listAudioNotesQuerySchema,
  audioNoteIdParamSchema,
} from "./lecture-audio-note.validation";

// Same subscription gate as the text-note controller. Kept inline rather than
// shared because the two modules will likely diverge (audio may grow per-row
// limits, transcoding hooks, etc.) and copy-paste here is cheaper than the
// abstraction.
async function authorizeRecorded(
  userId: string,
  videoId: string
): Promise<{ courseId: Types.ObjectId } | { error: string; status: number }> {
  const video = await Video.findById(videoId)
    .select("videoCategoryId status priceType")
    .lean();
  if (!video || !video.status) return { error: "Lecture not found.", status: 404 };

  const category = await VideoCategory.findById(video.videoCategoryId)
    .select("courseId")
    .lean();
  if (!category?.courseId) {
    return { error: "This lecture is not attached to a course.", status: 400 };
  }

  // Free lectures don't require a subscription — any authenticated user can
  // record audio notes on them.
  if (video.priceType === "free") {
    return { courseId: category.courseId as Types.ObjectId };
  }

  const sub = await PackageCourseSubscription.findOne({
    customerId: new Types.ObjectId(userId),
    courseId: category.courseId,
    status: true,
    paymentStatus: "verified",
    endAt: { $gt: new Date() },
  }).select("_id");
  if (!sub) {
    return { error: "Active subscription required to record audio notes.", status: 403 };
  }

  return { courseId: category.courseId as Types.ObjectId };
}

async function authorizeLive(
  userId: string,
  liveSessionId: string
): Promise<
  | { liveCourseIds: Types.ObjectId[] }
  | { error: string; status: number }
> {
  const session = await LiveSession.findById(liveSessionId)
    .select("liveCourseIds")
    .lean();
  if (!session) return { error: "Live session not found.", status: 404 };

  const liveCourseIds = (session.liveCourseIds ?? []) as Types.ObjectId[];
  if (liveCourseIds.length === 0) {
    return { error: "Audio notes are only available for subscribed live courses.", status: 403 };
  }

  const ok = await hasAccessToAnyLiveCourse(userId, liveCourseIds);
  if (!ok) {
    return { error: "Active subscription required to record audio notes.", status: 403 };
  }

  return { liveCourseIds };
}

// POST /api/v1/client/lecture-audio-notes
// multipart/form-data: field `audio` (file) + the body fields.
export const createAudioNote = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("createAudioNote invoked", { traceId, path: req.originalUrl, userId });

  // multer-s3 attaches storage metadata on the file object.
  const file = (req.file ?? undefined) as
    | (Express.Multer.File & { location?: string; key?: string; size?: number; mimetype?: string })
    | undefined;

  try {
    if (!userId) {
      logger.warn("createAudioNote unauthorized", { traceId });
      if (file?.key) await deleteFromS3FileUrl((file as any).location ?? "");
      return failure(res, "Unauthorized.", 401);
    }
    if (!file || !file.key) {
      logger.warn("createAudioNote missing file", { traceId, userId });
      return failure(res, "Audio file is required (field name: audio).", 400);
    }

    const parsed = createAudioNoteBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn("createAudioNote validation failed", { traceId, userId, issues: parsed.error.issues });
      await deleteFromS3FileUrl(file.location ?? "");
      return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { lectureType, videoId, liveSessionId, timestampSec, title, durationSec } = parsed.data;

    const doc: any = {
      customerId: new Types.ObjectId(userId),
      lectureType,
      timestampSec,
      title: title ?? "",
      audioUrl: file.location,
      audioKey: file.key,
      mimeType: file.mimetype ?? null,
      sizeBytes: file.size ?? null,
      durationSec: durationSec ?? null,
    };

    if (lectureType === "recorded") {
      const guard = await authorizeRecorded(userId, videoId!);
      if ("error" in guard) {
        logger.warn("createAudioNote auth failed (recorded)", { traceId, userId, videoId, message: guard.error });
        await deleteFromS3FileUrl(file.location ?? "");
        return failure(res, guard.error, guard.status);
      }
      doc.videoId = new Types.ObjectId(videoId!);
      doc.courseId = guard.courseId;
    } else {
      const guard = await authorizeLive(userId, liveSessionId!);
      if ("error" in guard) {
        logger.warn("createAudioNote auth failed (live)", { traceId, userId, liveSessionId, message: guard.error });
        await deleteFromS3FileUrl(file.location ?? "");
        return failure(res, guard.error, guard.status);
      }
      doc.liveSessionId = new Types.ObjectId(liveSessionId!);
      doc.liveCourseIds = guard.liveCourseIds;
    }

    const note = await LectureAudioNote.create(doc);
    logger.info("createAudioNote success", { traceId, userId, noteId: note._id, lectureType });
    return success(res, { note }, "Audio note created.", 201);
  } catch (err) {
    // Best-effort orphan cleanup if the DB write blew up after the upload landed.
    if (file?.location) await deleteFromS3FileUrl(file.location);
    logger.error("createAudioNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

// GET /api/v1/client/lecture-audio-notes?lectureType=recorded&videoId=...
//                                        | lectureType=live&liveSessionId=...
export const listAudioNotes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listAudioNotes invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) { logger.warn("listAudioNotes unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const parsed = listAudioNotesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      logger.warn("listAudioNotes validation failed", { traceId, userId, issues: parsed.error.issues });
      return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { lectureType, videoId, liveSessionId } = parsed.data;

    const filter: any = {
      customerId: new Types.ObjectId(userId),
      lectureType,
    };

    if (lectureType === "recorded") {
      const guard = await authorizeRecorded(userId, videoId!);
      if ("error" in guard) { logger.warn("listAudioNotes auth failed (recorded)", { traceId, userId, videoId, message: guard.error }); return failure(res, guard.error, guard.status); }
      filter.videoId = new Types.ObjectId(videoId!);
    } else {
      const guard = await authorizeLive(userId, liveSessionId!);
      if ("error" in guard) { logger.warn("listAudioNotes auth failed (live)", { traceId, userId, liveSessionId, message: guard.error }); return failure(res, guard.error, guard.status); }
      filter.liveSessionId = new Types.ObjectId(liveSessionId!);
    }

    const notes = await LectureAudioNote.find(filter)
      .sort({ timestampSec: 1, createdAt: 1 })
      .lean();

    logger.info("listAudioNotes success", { traceId, userId, lectureType, count: notes.length });
    return success(res, { notes }, "Audio notes fetched.", 200);
  } catch (err) {
    logger.error("listAudioNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

// PATCH /api/v1/client/lecture-audio-notes/:id
// Only metadata is editable — replacing the audio file means deleting and
// re-uploading.
export const updateAudioNote = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("updateAudioNote invoked", { traceId, path: req.originalUrl, userId, noteId: req.params.id });

  try {
    if (!userId) { logger.warn("updateAudioNote unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const params = audioNoteIdParamSchema.safeParse(req.params);
    if (!params.success) { logger.warn("updateAudioNote invalid id", { traceId, userId, issues: params.error.issues }); return failure(res, params.error.issues[0]?.message ?? "Invalid id", 400); }
    const body = updateAudioNoteBodySchema.safeParse(req.body);
    if (!body.success) { logger.warn("updateAudioNote validation failed", { traceId, userId, issues: body.error.issues }); return failure(res, body.error.issues[0]?.message ?? "Invalid request", 400); }

    const note = await LectureAudioNote.findOne({
      _id: params.data.id,
      customerId: new Types.ObjectId(userId),
    });
    if (!note) { logger.warn("updateAudioNote not found", { traceId, userId, noteId: params.data.id }); return failure(res, "Audio note not found.", 404); }

    if (note.lectureType === "recorded" && note.videoId) {
      const guard = await authorizeRecorded(userId, String(note.videoId));
      if ("error" in guard) { logger.warn("updateAudioNote auth failed (recorded)", { traceId, userId, message: guard.error }); return failure(res, guard.error, guard.status); }
    } else if (note.lectureType === "live" && note.liveSessionId) {
      const guard = await authorizeLive(userId, String(note.liveSessionId));
      if ("error" in guard) { logger.warn("updateAudioNote auth failed (live)", { traceId, userId, message: guard.error }); return failure(res, guard.error, guard.status); }
    }

    if (body.data.title !== undefined) note.title = body.data.title;
    if (body.data.timestampSec !== undefined) note.timestampSec = body.data.timestampSec;
    await note.save();

    logger.info("updateAudioNote success", { traceId, userId, noteId: note._id });
    return success(res, { note }, "Audio note updated.", 200);
  } catch (err) {
    logger.error("updateAudioNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};

// DELETE /api/v1/client/lecture-audio-notes/:id
export const deleteAudioNote = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("deleteAudioNote invoked", { traceId, path: req.originalUrl, userId, noteId: req.params.id });

  try {
    if (!userId) { logger.warn("deleteAudioNote unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const params = audioNoteIdParamSchema.safeParse(req.params);
    if (!params.success) { logger.warn("deleteAudioNote invalid id", { traceId, userId, issues: params.error.issues }); return failure(res, params.error.issues[0]?.message ?? "Invalid id", 400); }

    const note = await LectureAudioNote.findOneAndDelete({
      _id: params.data.id,
      customerId: new Types.ObjectId(userId),
    });
    if (!note) { logger.warn("deleteAudioNote not found", { traceId, userId, noteId: params.data.id }); return failure(res, "Audio note not found.", 404); }

    // Best-effort — if S3 delete fails, the row is already gone and the
    // orphaned object is acceptable (cleanup can be a periodic sweep).
    if (note.audioUrl) {
      try {
        await deleteFromS3FileUrl(note.audioUrl);
      } catch (s3err) {
        logger.warn("deleteAudioNote S3 delete failed", {
          traceId,
          userId,
          audioKey: note.audioKey,
          error: getErrorMessage(s3err),
        });
      }
    }

    logger.info("deleteAudioNote success", { traceId, userId, noteId: note._id });
    return success(res, {}, "Audio note deleted.", 200);
  } catch (err) {
    logger.error("deleteAudioNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};
