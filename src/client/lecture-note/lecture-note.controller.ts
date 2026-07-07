import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  createNoteSchema,
  updateNoteSchema,
  listNotesQuerySchema,
  noteIdParamSchema,
} from "./lecture-note.validation";
import { buildResumeNextCard } from "../learning/resumeCard";
import { buildLectureRef } from "../learning/lectureRef";
import { parseListQuery, buildPagination } from "../../utils/listQuery";
import * as lnSql from "../../modules/client-lecture-note/client-lecture-note.service";

// POST /api/v1/client/lecture-notes
export const createNote = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("createNote invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) { logger.warn("createNote unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) { logger.warn("createNote validation failed", { traceId, userId, issues: parsed.error.issues }); return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400); }
    const { lectureType, videoId, liveSessionId, timestampSec, content } = parsed.data;

    const cid = lnSql.parseLnId(String(userId));
    if (cid == null) return failure(res, "Unauthorized.", 401);
    if (lectureType === "recorded") {
      const vid = lnSql.parseLnId(String(videoId));
      if (vid == null) return failure(res, "Lecture not found.", 404);
      const guard = await lnSql.authorizeRecorded(cid, vid);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      const note = await lnSql.createNote({ customerId: cid, lectureType, timestampSec, content, videoId: vid, courseId: guard.courseId });
      return success(res, { note }, "Note created.", 201);
    }
    const lsid = lnSql.parseLnId(String(liveSessionId));
    if (lsid == null) return failure(res, "Live session not found.", 404);
    const guard = await lnSql.authorizeLive(cid, lsid);
    if ("error" in guard) return failure(res, guard.error, guard.status);
    const note = await lnSql.createNote({ customerId: cid, lectureType, timestampSec, content, liveSessionId: lsid, liveCourseIds: guard.liveCourseIds });
    return success(res, { note }, "Note created.", 201);
  } catch (err) {
    logger.error("createNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// GET /api/v1/client/lecture-notes?lectureType=recorded&videoId=...
//                                  | lectureType=live&liveSessionId=...
export const listNotes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listNotes invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) { logger.warn("listNotes unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const parsed = listNotesQuerySchema.safeParse(req.query);
    if (!parsed.success) { logger.warn("listNotes validation failed", { traceId, userId, issues: parsed.error.issues }); return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400); }
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
      ({ notes, total } = await lnSql.listNotes(cid, lectureType, { videoId: vid }, { search, skip, take: limit }));
      refInput = { lectureType: "recorded", userId, videoId: videoId! } as const;
    } else {
      const lsid = lnSql.parseLnId(String(liveSessionId));
      if (lsid == null) return failure(res, "Live session not found.", 404);
      const guard = await lnSql.authorizeLive(cid, lsid);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      ({ notes, total } = await lnSql.listNotes(cid, lectureType, { liveSessionId: lsid }, { search, skip, take: limit }));
      refInput = { lectureType: "live", userId, liveSessionId: liveSessionId! } as const;
    }
    const [lecture, resumeNext] = await Promise.all([buildLectureRef(refInput), buildResumeNextCard(refInput)]);
    return success(res, { notes, lecture, resumeNext, pagination: buildPagination(total, page, limit) }, "Notes fetched.", 200);
  } catch (err) {
    logger.error("listNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// GET /api/v1/client/lecture-notes/saved-materials
// Grouped "Saved Materials" listing — one row per **lecture** (the actual
// video or live session the notes were taken on), showing that lecture's
// title and the customer's note counts for it. Combines:
//   - recorded notes  → grouped by `videoId`       (lecture: Video)
//   - live notes      → grouped by `liveSessionId` (lecture: LiveSession)
// Each row is tagged with `kind` so the client can deep-link to the right
// player.
export const listSavedMaterialNotes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listSavedMaterialNotes invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) { logger.warn("listSavedMaterialNotes unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const { search, page, limit, skip } = parseListQuery(req.query);
    const cid = lnSql.parseLnId(String(userId));
    if (cid == null) return failure(res, "Unauthorized.", 401);
    const { items, total } = await lnSql.savedMaterials(cid, { search, skip, limit });
    return success(res, { items, pagination: buildPagination(total, page, limit) }, "Saved materials fetched.", 200);
  } catch (err) {
    logger.error("listSavedMaterialNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// PATCH /api/v1/client/lecture-notes/:id
export const updateNote = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("updateNote invoked", { traceId, path: req.originalUrl, userId, noteId: req.params.id });

  try {
    if (!userId) { logger.warn("updateNote unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const params = noteIdParamSchema.safeParse(req.params);
    if (!params.success) { logger.warn("updateNote invalid id", { traceId, userId, issues: params.error.issues }); return failure(res, params.error.issues[0]?.message ?? "Invalid id", 400); }
    const body = updateNoteSchema.safeParse(req.body);
    if (!body.success) { logger.warn("updateNote validation failed", { traceId, userId, issues: body.error.issues }); return failure(res, body.error.issues[0]?.message ?? "Invalid request", 400); }

    const cid = lnSql.parseLnId(String(userId));
    const nid = lnSql.parseLnId(String(params.data.id));
    if (cid == null || nid == null) return failure(res, "Note not found.", 404);
    const existing = await lnSql.findOwnedNote(nid, cid);
    if (!existing) return failure(res, "Note not found.", 404);
    // Re-check entitlement on write (lapsed sub locks editing).
    if (existing.lectureType === "recorded" && existing.videoId != null) {
      const g = await lnSql.authorizeRecorded(cid, existing.videoId);
      if ("error" in g) return failure(res, g.error, g.status);
    } else if (existing.lectureType === "live" && existing.liveSessionId != null) {
      const g = await lnSql.authorizeLive(cid, existing.liveSessionId);
      if ("error" in g) return failure(res, g.error, g.status);
    }
    const note = await lnSql.updateNote(nid, { content: body.data.content, timestampSec: body.data.timestampSec });
    return success(res, { note }, "Note updated.", 200);
  } catch (err) {
    logger.error("updateNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};

// DELETE /api/v1/client/lecture-notes/:id
export const deleteNote = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("deleteNote invoked", { traceId, path: req.originalUrl, userId, noteId: req.params.id });

  try {
    if (!userId) { logger.warn("deleteNote unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const params = noteIdParamSchema.safeParse(req.params);
    if (!params.success) { logger.warn("deleteNote invalid id", { traceId, userId, issues: params.error.issues }); return failure(res, params.error.issues[0]?.message ?? "Invalid id", 400); }

    const cid = lnSql.parseLnId(String(userId));
    const nid = lnSql.parseLnId(String(params.data.id));
    if (cid == null || nid == null) return failure(res, "Note not found.", 404);
    const existing = await lnSql.findOwnedNote(nid, cid);
    if (!existing) return failure(res, "Note not found.", 404);
    await lnSql.deleteNote(nid);
    return success(res, {}, "Note deleted.", 200);
  } catch (err) {
    logger.error("deleteNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, "Something went wrong. Please try again later.", 500);
  }
};
