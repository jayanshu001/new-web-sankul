import { Request, Response } from "express";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  createAudioNoteBodySchema,
  updateAudioNoteBodySchema,
  listAudioNotesQuerySchema,
  audioNoteIdParamSchema,
} from "./lecture-audio-note.validation";
import { buildResumeNextCard } from "../learning/resumeCard";
import { buildLectureRef } from "../learning/lectureRef";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import * as lnSql from "../../modules/client-lecture-note/client-lecture-note.service";

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

    const cid = lnSql.parseLnId(String(userId));
    if (cid == null) { await deleteFromS3FileUrl(file.location ?? ""); return failure(res, "Unauthorized.", 401); }
    const common = { customerId: cid, lectureType, timestampSec, title: title ?? "", audioUrl: file.location!, audioKey: file.key!, mimeType: file.mimetype ?? null, sizeBytes: file.size ?? null, durationSec: durationSec ?? null };
    if (lectureType === "recorded") {
      const vid = lnSql.parseLnId(String(videoId));
      if (vid == null) { await deleteFromS3FileUrl(file.location ?? ""); return failure(res, "Lecture not found.", 404); }
      const guard = await lnSql.authorizeRecorded(cid, vid);
      if ("error" in guard) { await deleteFromS3FileUrl(file.location ?? ""); return failure(res, guard.error, guard.status); }
      const note = await lnSql.createAudioNote({ ...common, videoId: vid, courseId: guard.courseId });
      return success(res, { note }, "Audio note created.", 201);
    }
    const lsid = lnSql.parseLnId(String(liveSessionId));
    if (lsid == null) { await deleteFromS3FileUrl(file.location ?? ""); return failure(res, "Live session not found.", 404); }
    const guard = await lnSql.authorizeLive(cid, lsid);
    if ("error" in guard) { await deleteFromS3FileUrl(file.location ?? ""); return failure(res, guard.error, guard.status); }
    const note = await lnSql.createAudioNote({ ...common, liveSessionId: lsid, liveCourseIds: guard.liveCourseIds });
    return success(res, { note }, "Audio note created.", 201);
  } catch (err) {
    // Best-effort orphan cleanup if the DB write blew up after the upload landed.
    if (file?.location) await deleteFromS3FileUrl(file.location);
    logger.error("createAudioNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
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
    const { search, page, limit, skip } = parseListQuery(req.query);

    const cid = lnSql.parseLnId(String(userId));
    if (cid == null) return failure(res, "Unauthorized.", 401);
    let notes;
    let total;
    let refInput: any;
    if (lectureType === "recorded") {
      const vid = lnSql.parseLnId(String(videoId));
      if (vid == null) return failure(res, "Lecture not found.", 404);
      const guard = await lnSql.authorizeRecorded(cid, vid);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      ({ notes, total } = await lnSql.listAudioNotes(cid, lectureType, { videoId: vid }, { search, skip, take: limit }));
      refInput = { lectureType: "recorded", userId, videoId: videoId! } as const;
    } else {
      const lsid = lnSql.parseLnId(String(liveSessionId));
      if (lsid == null) return failure(res, "Live session not found.", 404);
      const guard = await lnSql.authorizeLive(cid, lsid);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      ({ notes, total } = await lnSql.listAudioNotes(cid, lectureType, { liveSessionId: lsid }, { search, skip, take: limit }));
      refInput = { lectureType: "live", userId, liveSessionId: liveSessionId! } as const;
    }
    const [lecture, resumeNext] = await Promise.all([buildLectureRef(refInput), buildResumeNextCard(refInput)]);
    // Live-course recordings: surface the owning liveCourseId on every note so
    // the FE opens the live player straight from the audio-notes list.
    const notesOut = lnSql.enrichNotesWithLiveCourse(notes, (lecture as any)?.liveCourseId ?? null);
    return success(res, { notes: notesOut, lecture, resumeNext, pagination: buildPagination(total, page, limit) }, "Audio notes fetched.", 200);
  } catch (err) {
    logger.error("listAudioNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
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

    const cid = lnSql.parseLnId(String(userId));
    const nid = lnSql.parseLnId(String(params.data.id));
    if (cid == null || nid == null) return failure(res, "Audio note not found.", 404);
    const existing = await lnSql.findOwnedAudioNote(nid, cid);
    if (!existing) return failure(res, "Audio note not found.", 404);
    if (existing.lectureType === "recorded" && existing.videoId != null) {
      const g = await lnSql.authorizeRecorded(cid, existing.videoId);
      if ("error" in g) return failure(res, g.error, g.status);
    } else if (existing.lectureType === "live" && existing.liveSessionId != null) {
      const g = await lnSql.authorizeLive(cid, existing.liveSessionId);
      if ("error" in g) return failure(res, g.error, g.status);
    }
    const note = await lnSql.updateAudioNote(nid, { title: body.data.title, timestampSec: body.data.timestampSec });
    return success(res, { note }, "Audio note updated.", 200);
  } catch (err) {
    logger.error("updateAudioNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
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

    const cid = lnSql.parseLnId(String(userId));
    const nid = lnSql.parseLnId(String(params.data.id));
    if (cid == null || nid == null) return failure(res, "Audio note not found.", 404);
    const existing = await lnSql.findOwnedAudioNote(nid, cid);
    if (!existing) return failure(res, "Audio note not found.", 404);
    await lnSql.deleteAudioNote(nid);
    if (existing.audioUrl) {
      try { await deleteFromS3FileUrl(existing.audioUrl); }
      catch (s3err) { logger.warn("deleteAudioNote (sql) S3 delete failed", { traceId, userId, audioKey: existing.audioKey, error: getErrorMessage(s3err) }); }
    }
    return success(res, {}, "Audio note deleted.", 200);
  } catch (err) {
    logger.error("deleteAudioNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
