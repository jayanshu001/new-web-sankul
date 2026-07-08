import { Request, Response } from "express";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import { deleteFromS3FileUrl } from "../../middlewares/upload";
import {
  createNoteSchema,
  updateNoteSchema,
  listNotesQuerySchema,
  noteIdParamSchema,
  deleteSavedMaterialSchema,
} from "./lecture-note.validation";
import type { SavedMaterialTarget } from "../../modules/client-lecture-note/client-lecture-note.service";
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

// DELETE /api/v1/client/lecture-notes/saved-materials
// Bulk-delete EVERY text + audio note for one saved-material group (the trash
// action on a Saved Notes row). Target mirrors the `kind` + id fields the
// saved-materials listing returns. Accepts the target in the JSON body OR the
// query string (body wins on conflict). Scoped to the authenticated user and
// idempotent — deleting a group with no notes returns success with zero counts
// so the app can clear a stale row.
export const deleteSavedMaterialNotes = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("deleteSavedMaterialNotes invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) { logger.warn("deleteSavedMaterialNotes unauthorized", { traceId }); return failure(res, "Unauthorized.", 401); }

    const raw = { ...(req.query as Record<string, unknown>), ...(req.body as Record<string, unknown>) };
    const parsed = deleteSavedMaterialSchema.safeParse(raw);
    if (!parsed.success) { logger.warn("deleteSavedMaterialNotes validation failed", { traceId, userId, issues: parsed.error.issues }); return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400); }

    const cid = lnSql.parseLnId(String(userId));
    if (cid == null) return failure(res, "Unauthorized.", 401);

    const d = parsed.data;
    // Resolve exactly one id → int, matching the kind. Validation already
    // guaranteed the required field is present.
    let target: SavedMaterialTarget;
    if (d.kind === "recorded") {
      const id = lnSql.parseLnId(String(d.videoId)); if (id == null) return failure(res, "kind and videoId are required for recorded materials", 400);
      target = { kind: "recorded", videoId: id };
    } else if (d.kind === "live") {
      const id = lnSql.parseLnId(String(d.liveSessionId)); if (id == null) return failure(res, "kind and liveSessionId are required for live materials", 400);
      target = { kind: "live", liveSessionId: id };
    } else if (d.kind === "course") {
      const id = lnSql.parseLnId(String(d.courseId)); if (id == null) return failure(res, "kind and courseId are required for course materials", 400);
      target = { kind: "course", courseId: id };
    } else {
      const id = lnSql.parseLnId(String(d.liveCourseId)); if (id == null) return failure(res, "kind and liveCourseId are required for live_course materials", 400);
      target = { kind: "live_course", liveCourseId: id };
    }

    const { deletedTextNotes, deletedVoiceNotes, audioUrls } = await lnSql.deleteSavedMaterialNotes(cid, target);

    // Best-effort S3 cleanup for the deleted audio notes — mirror single audio
    // delete: a failed object delete must not fail the request (rows are gone).
    for (const url of audioUrls) {
      try { await deleteFromS3FileUrl(url); }
      catch (s3err) { logger.warn("deleteSavedMaterialNotes S3 delete failed", { traceId, userId, url, error: getErrorMessage(s3err) }); }
    }

    logger.info("deleteSavedMaterialNotes success", { traceId, userId, kind: d.kind, deletedTextNotes, deletedVoiceNotes });
    return success(res, { deletedTextNotes, deletedVoiceNotes }, "Saved material notes deleted.", 200);
  } catch (err) {
    logger.error("deleteSavedMaterialNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
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
