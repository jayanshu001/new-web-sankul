import { Request, Response } from "express";
import { Types } from "mongoose";
import { LectureNote } from "../../models/customer/LectureNote.model";
import { LectureAudioNote } from "../../models/customer/LectureAudioNote.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { hasAccessToAnyLiveCourse } from "../live-course/entitlement";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";
import {
  createNoteSchema,
  updateNoteSchema,
  listNotesQuerySchema,
  noteIdParamSchema,
} from "./lecture-note.validation";

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

  const category = await VideoCategory.findById(video.videoCategoryId)
    .select("courseId")
    .lean();
  if (!category?.courseId) {
    return { error: "This lecture is not attached to a course.", status: 400 };
  }

  // Free lectures don't require a subscription — any authenticated user can
  // take notes on them.
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
    return { error: "Active subscription required to take notes.", status: 403 };
  }

  return { courseId: category.courseId as Types.ObjectId };
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
  const userId = req.user?.id;
  try {
    if (!userId) return failure(res, "Unauthorized.", 401);

    const parsed = createNoteSchema.safeParse(req.body);
    if (!parsed.success) {
      return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { lectureType, videoId, liveSessionId, timestampSec, content } = parsed.data;

    const doc: any = {
      customerId: new Types.ObjectId(userId),
      lectureType,
      timestampSec,
      content,
    };

    if (lectureType === "recorded") {
      const guard = await authorizeRecorded(userId, videoId!);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      doc.videoId = new Types.ObjectId(videoId!);
      doc.courseId = guard.courseId;
    } else {
      const guard = await authorizeLive(userId, liveSessionId!);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      doc.liveSessionId = new Types.ObjectId(liveSessionId!);
      doc.liveCourseIds = guard.liveCourseIds;
    }

    const note = await LectureNote.create(doc);
    return success(res, { note }, "Note created.", 201);
  } catch (err) {
    logger.error("createNote failed", { userId, error: getErrorMessage(err) });
    return failure(res, getErrorMessage(err), 500);
  }
};

// GET /api/v1/client/lecture-notes?lectureType=recorded&videoId=...
//                                  | lectureType=live&liveSessionId=...
export const listNotes = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  try {
    if (!userId) return failure(res, "Unauthorized.", 401);

    const parsed = listNotesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return failure(res, parsed.error.issues[0]?.message ?? "Invalid request", 400);
    }
    const { lectureType, videoId, liveSessionId } = parsed.data;

    const filter: any = {
      customerId: new Types.ObjectId(userId),
      lectureType,
    };

    if (lectureType === "recorded") {
      const guard = await authorizeRecorded(userId, videoId!);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      filter.videoId = new Types.ObjectId(videoId!);
    } else {
      const guard = await authorizeLive(userId, liveSessionId!);
      if ("error" in guard) return failure(res, guard.error, guard.status);
      filter.liveSessionId = new Types.ObjectId(liveSessionId!);
    }

    const notes = await LectureNote.find(filter)
      .sort({ timestampSec: 1, createdAt: 1 })
      .lean();

    return success(res, { notes }, "Notes fetched.", 200);
  } catch (err) {
    logger.error("listNotes failed", { userId, error: getErrorMessage(err) });
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
  const userId = req.user?.id;
  try {
    if (!userId) return failure(res, "Unauthorized.", 401);

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

    return success(res, { items }, "Saved materials fetched.", 200);
  } catch (err) {
    logger.error("listSavedMaterialNotes failed", { userId, error: getErrorMessage(err) });
    return failure(res, getErrorMessage(err), 500);
  }
};

// PATCH /api/v1/client/lecture-notes/:id
export const updateNote = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  try {
    if (!userId) return failure(res, "Unauthorized.", 401);

    const params = noteIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return failure(res, params.error.issues[0]?.message ?? "Invalid id", 400);
    }
    const body = updateNoteSchema.safeParse(req.body);
    if (!body.success) {
      return failure(res, body.error.issues[0]?.message ?? "Invalid request", 400);
    }

    const note = await LectureNote.findOne({
      _id: params.data.id,
      customerId: new Types.ObjectId(userId),
    });
    if (!note) return failure(res, "Note not found.", 404);

    // Re-check entitlement on every write — a lapsed subscription must lock
    // editing too, not just creation.
    if (note.lectureType === "recorded" && note.videoId) {
      const guard = await authorizeRecorded(userId, String(note.videoId));
      if ("error" in guard) return failure(res, guard.error, guard.status);
    } else if (note.lectureType === "live" && note.liveSessionId) {
      const guard = await authorizeLive(userId, String(note.liveSessionId));
      if ("error" in guard) return failure(res, guard.error, guard.status);
    }

    if (body.data.content !== undefined) note.content = body.data.content;
    if (body.data.timestampSec !== undefined) note.timestampSec = body.data.timestampSec;
    await note.save();

    return success(res, { note }, "Note updated.", 200);
  } catch (err) {
    logger.error("updateNote failed", { userId, error: getErrorMessage(err) });
    return failure(res, getErrorMessage(err), 500);
  }
};

// DELETE /api/v1/client/lecture-notes/:id
export const deleteNote = async (req: Request, res: Response) => {
  const userId = req.user?.id;
  try {
    if (!userId) return failure(res, "Unauthorized.", 401);

    const params = noteIdParamSchema.safeParse(req.params);
    if (!params.success) {
      return failure(res, params.error.issues[0]?.message ?? "Invalid id", 400);
    }

    const result = await LectureNote.findOneAndDelete({
      _id: params.data.id,
      customerId: new Types.ObjectId(userId),
    });
    if (!result) return failure(res, "Note not found.", 404);

    return success(res, {}, "Note deleted.", 200);
  } catch (err) {
    logger.error("deleteNote failed", { userId, error: getErrorMessage(err) });
    return failure(res, getErrorMessage(err), 500);
  }
};
