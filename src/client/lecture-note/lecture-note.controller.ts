import { Request, Response } from "express";
import { Types } from "mongoose";
import { LectureNote } from "../../models/customer/LectureNote.model";
import { LectureAudioNote } from "../../models/customer/LectureAudioNote.model";
import { Video } from "../../models/course/Video.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { hasAccessToAnyLiveCourse } from "../live-course/entitlement";
import { resolveVideoCourseId } from "../course/resolveVideoCourse";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  createNoteSchema,
  updateNoteSchema,
  listNotesQuerySchema,
  noteIdParamSchema,
} from "./lecture-note.validation";
import { buildResumeNextCard } from "../learning/resumeCard";

/**
 * Resolve the recorded lecture and confirm the customer holds an active,
 * verified subscription to the course it lives under. Same predicate as
 * lecture.controller / progress.controller so access can't drift.
 */
async function authorizeRecorded(
  userId: string,
  videoId: string
): Promise<{ courseId: Types.ObjectId } | { error: string; status: number }> {
  const video = await Video.findById(videoId)
    .select("videoCategoryId status priceType")
    .lean();
  if (!video || !video.status) return { error: "Lecture not found.", status: 404 };

  // Robustly resolve the owning course — a video often sits under a child
  // category whose own courseId is null while the link lives on an ancestor or
  // on Course.videoCategoryId. Reading only the leaf wrongly reports
  // "not attached to a course". See resolveVideoCourseId.
  const courseId = await resolveVideoCourseId(video.videoCategoryId);
  if (!courseId) {
    return { error: "This lecture is not attached to a course.", status: 400 };
  }

  // Free lectures don't require a subscription — any authenticated user can
  // take notes on them.
  if (video.priceType === "free") {
    return { courseId };
  }

  const sub = await PackageCourseSubscription.findOne({
    customerId: new Types.ObjectId(userId),
    courseId,
    status: true,
    paymentStatus: "verified",
    endAt: { $gt: new Date() },
  }).select("_id");
  if (!sub) {
    return { error: "Active subscription required to take notes.", status: 403 };
  }

  return { courseId };
}

/**
 * Resolve the live session and confirm the customer has access to at least
 * one of its attached live courses. Open sessions (no liveCourseIds) are not
 * subscriber-gated, so notes are disallowed on them — there is no "subscriber"
 * concept to scope the feature.
 */
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
    return { error: "Notes are only available for subscribed live courses.", status: 403 };
  }

  const ok = await hasAccessToAnyLiveCourse(userId, liveCourseIds);
  if (!ok) {
    return { error: "Active subscription required to take notes.", status: 403 };
  }

  return { liveCourseIds };
}

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

    const doc: any = {
      customerId: new Types.ObjectId(userId),
      lectureType,
      timestampSec,
      content,
    };

    if (lectureType === "recorded") {
      const guard = await authorizeRecorded(userId, videoId!);
      if ("error" in guard) { logger.warn("createNote auth failed (recorded)", { traceId, userId, videoId, message: guard.error }); return failure(res, guard.error, guard.status); }
      doc.videoId = new Types.ObjectId(videoId!);
      doc.courseId = guard.courseId;
    } else {
      const guard = await authorizeLive(userId, liveSessionId!);
      if ("error" in guard) { logger.warn("createNote auth failed (live)", { traceId, userId, liveSessionId, message: guard.error }); return failure(res, guard.error, guard.status); }
      doc.liveSessionId = new Types.ObjectId(liveSessionId!);
      doc.liveCourseIds = guard.liveCourseIds;
    }

    const note = await LectureNote.create(doc);
    logger.info("createNote success", { traceId, userId, noteId: note._id, lectureType });
    return success(res, { note }, "Note created.", 201);
  } catch (err) {
    logger.error("createNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
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

    const filter: any = {
      customerId: new Types.ObjectId(userId),
      lectureType,
    };

    if (lectureType === "recorded") {
      const guard = await authorizeRecorded(userId, videoId!);
      if ("error" in guard) { logger.warn("listNotes auth failed (recorded)", { traceId, userId, videoId, message: guard.error }); return failure(res, guard.error, guard.status); }
      filter.videoId = new Types.ObjectId(videoId!);
    } else {
      const guard = await authorizeLive(userId, liveSessionId!);
      if ("error" in guard) { logger.warn("listNotes auth failed (live)", { traceId, userId, liveSessionId, message: guard.error }); return failure(res, guard.error, guard.status); }
      filter.liveSessionId = new Types.ObjectId(liveSessionId!);
    }

    const notes = await LectureNote.find(filter)
      .sort({ timestampSec: 1, createdAt: 1 })
      .lean();

    const resumeNext = await buildResumeNextCard(
      lectureType === "recorded"
        ? { lectureType: "recorded", userId, videoId: videoId! }
        : { lectureType: "live", userId, liveSessionId: liveSessionId! }
    );

    logger.info("listNotes success", { traceId, userId, lectureType, count: notes.length, hasResume: !!resumeNext });
    return success(res, { notes, resumeNext }, "Notes fetched.", 200);
  } catch (err) {
    logger.error("listNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
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

    const customerId = new Types.ObjectId(userId);

    type Bucket = { textNotesCount: number; voiceNotesCount: number; lastNoteAt: Date };
    const recorded = new Map<string, Bucket>();
    const live = new Map<string, Bucket>();

    const bump = (
      map: Map<string, Bucket>,
      key: string,
      field: "textNotesCount" | "voiceNotesCount",
      count: number,
      at: Date
    ) => {
      const existing = map.get(key);
      if (existing) {
        existing[field] += count;
        if (at > existing.lastNoteAt) existing.lastNoteAt = at;
      } else {
        map.set(key, {
          textNotesCount: field === "textNotesCount" ? count : 0,
          voiceNotesCount: field === "voiceNotesCount" ? count : 0,
          lastNoteAt: at,
        });
      }
    };

    type AggRow = { _id: Types.ObjectId; count: number; lastNoteAt: Date };

    // Recorded — group by videoId (the lecture itself).
    const recordedTextAgg = await LectureNote.aggregate<AggRow>([
      { $match: { customerId, lectureType: "recorded", videoId: { $ne: null } } },
      { $group: { _id: "$videoId", count: { $sum: 1 }, lastNoteAt: { $max: "$updatedAt" } } },
    ]);
    const recordedVoiceAgg = await LectureAudioNote.aggregate<AggRow>([
      { $match: { customerId, lectureType: "recorded", videoId: { $ne: null } } },
      { $group: { _id: "$videoId", count: { $sum: 1 }, lastNoteAt: { $max: "$updatedAt" } } },
    ]);
    for (const r of recordedTextAgg) bump(recorded, String(r._id), "textNotesCount", r.count, r.lastNoteAt);
    for (const r of recordedVoiceAgg) bump(recorded, String(r._id), "voiceNotesCount", r.count, r.lastNoteAt);

    // Live — group by liveSessionId (the session itself).
    const liveTextAgg = await LectureNote.aggregate<AggRow>([
      { $match: { customerId, lectureType: "live", liveSessionId: { $ne: null } } },
      { $group: { _id: "$liveSessionId", count: { $sum: 1 }, lastNoteAt: { $max: "$updatedAt" } } },
    ]);
    const liveVoiceAgg = await LectureAudioNote.aggregate<AggRow>([
      { $match: { customerId, lectureType: "live", liveSessionId: { $ne: null } } },
      { $group: { _id: "$liveSessionId", count: { $sum: 1 }, lastNoteAt: { $max: "$updatedAt" } } },
    ]);
    for (const r of liveTextAgg) bump(live, String(r._id), "textNotesCount", r.count, r.lastNoteAt);
    for (const r of liveVoiceAgg) bump(live, String(r._id), "voiceNotesCount", r.count, r.lastNoteAt);

    const videoDocs = await Video.find({
      _id: { $in: Array.from(recorded.keys()).map((id) => new Types.ObjectId(id)) },
    })
      .select("title")
      .lean();
    const liveSessionDocs = await LiveSession.find({
      _id: { $in: Array.from(live.keys()).map((id) => new Types.ObjectId(id)) },
    })
      .select("title")
      .lean();
    const videoTitle = new Map(videoDocs.map((v) => [String(v._id), v.title]));
    const liveSessionTitle = new Map(liveSessionDocs.map((s) => [String(s._id), s.title]));

    const items = [
      ...Array.from(recorded.entries()).map(([id, b]) => ({
        kind: "recorded" as const,
        videoId: id,
        liveSessionId: null as string | null,
        title: videoTitle.get(id) ?? null,
        textNotesCount: b.textNotesCount,
        voiceNotesCount: b.voiceNotesCount,
        lastNoteAt: b.lastNoteAt,
      })),
      ...Array.from(live.entries()).map(([id, b]) => ({
        kind: "live" as const,
        videoId: null as string | null,
        liveSessionId: id,
        title: liveSessionTitle.get(id) ?? null,
        textNotesCount: b.textNotesCount,
        voiceNotesCount: b.voiceNotesCount,
        lastNoteAt: b.lastNoteAt,
      })),
    ]
      .filter((row) => row.title !== null && row.title !== "")
      .sort((a, b) => b.lastNoteAt.getTime() - a.lastNoteAt.getTime());

    logger.info("listSavedMaterialNotes success", { traceId, userId, count: items.length });
    return success(res, { items }, "Saved materials fetched.", 200);
  } catch (err) {
    logger.error("listSavedMaterialNotes failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
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

    const note = await LectureNote.findOne({
      _id: params.data.id,
      customerId: new Types.ObjectId(userId),
    });
    if (!note) { logger.warn("updateNote not found", { traceId, userId, noteId: params.data.id }); return failure(res, "Note not found.", 404); }

    // Re-check entitlement on every write — a lapsed subscription must lock
    // editing too, not just creation.
    if (note.lectureType === "recorded" && note.videoId) {
      const guard = await authorizeRecorded(userId, String(note.videoId));
      if ("error" in guard) { logger.warn("updateNote auth failed (recorded)", { traceId, userId, message: guard.error }); return failure(res, guard.error, guard.status); }
    } else if (note.lectureType === "live" && note.liveSessionId) {
      const guard = await authorizeLive(userId, String(note.liveSessionId));
      if ("error" in guard) { logger.warn("updateNote auth failed (live)", { traceId, userId, message: guard.error }); return failure(res, guard.error, guard.status); }
    }

    if (body.data.content !== undefined) note.content = body.data.content;
    if (body.data.timestampSec !== undefined) note.timestampSec = body.data.timestampSec;
    await note.save();

    logger.info("updateNote success", { traceId, userId, noteId: note._id });
    return success(res, { note }, "Note updated.", 200);
  } catch (err) {
    logger.error("updateNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
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

    const result = await LectureNote.findOneAndDelete({
      _id: params.data.id,
      customerId: new Types.ObjectId(userId),
    });
    if (!result) { logger.warn("deleteNote not found", { traceId, userId, noteId: params.data.id }); return failure(res, "Note not found.", 404); }

    logger.info("deleteNote success", { traceId, userId, noteId: result._id });
    return success(res, {}, "Note deleted.", 200);
  } catch (err) {
    logger.error("deleteNote failed", { traceId, userId, error: getErrorMessage(err), stack: (err as Error).stack });
    return failure(res, getErrorMessage(err), 500);
  }
};
