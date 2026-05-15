import { Request, Response } from "express";
import { Types } from "mongoose";
import { LectureNote } from "../../models/customer/LectureNote.model";
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
  const video = await Video.findById(videoId).select("videoCategoryId status").lean();
  if (!video || !video.status) return { error: "Lecture not found.", status: 404 };

  const category = await VideoCategory.findById(video.videoCategoryId)
    .select("courseId")
    .lean();
  if (!category?.courseId) {
    return { error: "This lecture is not attached to a course.", status: 400 };
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
