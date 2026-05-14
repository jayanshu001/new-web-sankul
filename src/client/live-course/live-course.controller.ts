import { Request, Response } from "express";
import mongoose from "mongoose";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCoursePlan } from "../../models/course/LiveCoursePlan.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Video } from "../../models/course/Video.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { hasAccessToAnyLiveCourse, buildPurchaseOptions } from "./entitlement";
import { success, failure, getErrorMessage } from "../../utils/httpResponse";
import logger from "../../utils/logger";

// Pick the platform-specific playable id/url for a Video document.
function videoSourceUrl(v: {
  platform: string;
  youtube_id?: string | null;
  vimeo_id?: string | null;
  aws_id?: string | null;
}): string | null {
  if (v.platform === "youtube") return v.youtube_id ?? null;
  if (v.platform === "vimeo") return v.vimeo_id ?? null;
  return v.aws_id ?? null; // "aws" — recordings promoted from live sessions land here
}

// GET /api/v1/client/live-courses
export const listLiveCoursesForClient = async (req: Request, res: Response) => {
  try {
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, parseInt(req.query.limit as string) || 20);
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

    const query: Record<string, any> = { status: true };
    if (search) query.name = { $regex: search, $options: "i" };

    const [rows, total] = await Promise.all([
      LiveCourse.find(query)
        .sort({ ordered: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate("courseEducatorId", "name image")
        .populate("courseSubjectCategoryId", "title slug")
        .lean(),
      LiveCourse.countDocuments(query),
    ]);

    return success(res, { liveCourses: rows, total, page, limit }, "Live courses fetched.");
  } catch (err) {
    logger.error("Client live-courses list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list live courses.", 500);
  }
};

// GET /api/v1/client/live-courses/:id
// Includes plans + whether the current customer already has access.
export const getLiveCourseForClient = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid live course id.", 422);

    const [course, plans] = await Promise.all([
      LiveCourse.findOne({ _id: id, status: true })
        .populate("courseEducatorId", "name image about")
        .populate("courseSubjectCategoryId", "title slug")
        .lean(),
      LiveCoursePlan.find({ liveCourseId: id, status: true })
        .sort({ price: 1 })
        .lean(),
    ]);
    if (!course) return failure(res, "Live course not found.", 404);

    const [subscribed, subjectsCount] = await Promise.all([
      hasAccessToAnyLiveCourse(req.user?.id, [id]),
      // "Subjects" on the header stat bar = folders under this live course.
      VideoCategory.countDocuments({ liveCourseId: id }),
    ]);

    // Header stat bar.
    const stats = {
      subjectsCount,
      materialsCount: course.materialCategories?.length ?? 0,
      classType: course.classType ?? "live",
    };

    // Plans enriched with the strikethrough-price math the UI needs.
    const plansOut = plans.map((p) => {
      const original =
        typeof p.originalPrice === "number" && p.originalPrice > p.price
          ? p.originalPrice
          : null;
      const discountPercent = original
        ? Math.round(((original - p.price) / original) * 100)
        : 0;
      return { ...p, originalPrice: original, discountPercent };
    });

    return success(
      res,
      { liveCourse: course, stats, plans: plansOut, subscribed },
      "Live course fetched."
    );
  } catch (err) {
    logger.error("Client live-course detail failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch live course.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/sessions
// Filter: upcoming=true → SCHEDULED + scheduledAt >= now.
export const listSessionsForCourseClient = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) return failure(res, "Invalid live course id.", 422);

    const exists = await LiveCourse.exists({ _id: id, status: true });
    if (!exists) return failure(res, "Live course not found.", 404);

    const status = typeof req.query.status === "string" ? req.query.status : undefined;
    const upcoming = req.query.upcoming === "true";
    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    const query: Record<string, any> = { liveCourseIds: id };
    if (status) query.status = status;
    if (upcoming) {
      query.status = "SCHEDULED";
      query.scheduledAt = { $gte: new Date() };
    }

    const [rows, total] = await Promise.all([
      LiveSession.find(query)
        .sort({ scheduledAt: 1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title status scheduledAt streamId recordings liveCourseIds createdAt updatedAt")
        .lean(),
      LiveSession.countDocuments(query),
    ]);

    // The list is metadata only — playback URLs (hlsUrl/recordings) are never
    // returned here. They come from GET /client/live-sessions/:id, which
    // applies the per-viewer preview / subscription gate. We expose just a
    // `hasRecordings` flag so the UI can show a "watch recording" affordance.
    const sessions = rows.map((s) => ({
      _id: s._id,
      title: s.title,
      status: s.status,
      scheduledAt: s.scheduledAt ?? null,
      streamId: s.streamId ?? null,
      liveCourseIds: s.liveCourseIds ?? [],
      hasRecordings: Array.isArray(s.recordings) && s.recordings.length > 0,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
    }));

    return success(res, { sessions, total, page, limit }, "Sessions fetched.");
  } catch (err) {
    logger.error("Client live-course sessions list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list sessions.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/recordings
// All recorded lectures for a live course, grouped by folder. These are the
// Videos promoted from past LiveSession recordings (plus any manually added
// videos). The folder/lecture STRUCTURE is always returned so the UI can show
// what the course contains, but a lecture's playable `videoUrl` is only
// included when the customer is entitled (active subscription) or the lecture
// is explicitly free. Non-subscribers also get `purchaseOptions` for the popup.
export const listLiveCourseRecordings = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name image")
      .lean();
    if (!course) return failure(res, "Live course not found.", 404);

    const folders = await VideoCategory.find({ liveCourseId: id, status: true })
      .sort({ order_by: 1, createdAt: 1 })
      .select("_id title image order_by")
      .lean();

    const folderIds = folders.map((f) => f._id);
    const videos = folderIds.length
      ? await Video.find({ videoCategoryId: { $in: folderIds }, status: true })
          .sort({ order: 1, createdAt: 1 })
          .lean()
      : [];

    const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, [id]);

    const videosByFolder = new Map<string, typeof videos>();
    for (const v of videos) {
      const key = String(v.videoCategoryId);
      if (!videosByFolder.has(key)) videosByFolder.set(key, []);
      videosByFolder.get(key)!.push(v);
    }

    const shapeLecture = (v: (typeof videos)[number]) => {
      const canPlay = subscribed || v.priceType === "free";
      return {
        _id: String(v._id),
        title: v.title ?? "",
        topic: v.topic ?? "",
        platform: v.platform,
        priceType: v.priceType,
        order: v.order,
        locked: !canPlay,
        videoUrl: canPlay ? videoSourceUrl(v) : null,
      };
    };

    const folderPayload = folders.map((f) => ({
      folderId: String(f._id),
      title: f.title,
      image: f.image,
      order: f.order_by,
      lectures: (videosByFolder.get(String(f._id)) ?? []).map(shapeLecture),
    }));

    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name, image: course.image },
        subscribed,
        totalLectures: videos.length,
        folders: folderPayload,
        purchaseOptions: subscribed ? [] : await buildPurchaseOptions([id]),
      },
      "Recorded lectures fetched."
    );
  } catch (err) {
    logger.error("Client live-course recordings list failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list recorded lectures.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/lecture/:videoId
// Gated single-lecture playback for a live course's recorded video. Mirrors
// the recorded-course GET /courses/lecture flow: verifies the video sits in a
// folder of this course, then requires an active subscription unless the
// lecture is free. On 403 the purchase popup data rides along in `data`.
export const getLiveCourseLecture = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    const videoId = String(req.params.videoId ?? "");
    if (!mongoose.Types.ObjectId.isValid(id) || !mongoose.Types.ObjectId.isValid(videoId)) {
      return failure(res, "Invalid live course or video id.", 422);
    }

    const video = await Video.findById(videoId).lean();
    if (!video || !video.status) return failure(res, "Lecture not found.", 404);

    // The video must belong to a folder owned by THIS live course.
    const folder = await VideoCategory.findOne({
      _id: video.videoCategoryId,
      liveCourseId: id,
    })
      .select("_id")
      .lean();
    if (!folder) return failure(res, "Lecture does not belong to this live course.", 404);

    if (video.priceType !== "free") {
      const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, [id]);
      if (!subscribed) {
        return failure(
          res,
          "Subscribe to this live course to watch this lecture.",
          403,
          {},
          { purchaseOptions: await buildPurchaseOptions([id]) }
        );
      }
    }

    return success(
      res,
      {
        _id: String(video._id),
        title: video.title ?? "",
        topic: video.topic ?? "",
        platform: video.platform,
        priceType: video.priceType,
        videoUrl: videoSourceUrl(video),
      },
      "Lecture fetched."
    );
  } catch (err) {
    logger.error("Client live-course lecture fetch failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch lecture.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/session-recordings
// The flat list of recorded live classes for a course — every ENDED/READY
// LiveSession that carries Streamos-delivered recordings. This is distinct
// from GET /:id/recordings, which lists Videos an admin promoted into folders;
// here we surface the raw Streamos recordings straight off the session, so a
// recorded class shows up even before anyone files it into a folder.
//
// Metadata only — the mp4 URLs are NOT in this list. To watch one, open
// GET /api/v1/client/live-sessions/:sessionId, which applies the per-viewer
// preview / subscription gate.
export const listLiveCourseSessionRecordings = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name image")
      .lean();
    if (!course) return failure(res, "Live course not found.", 404);

    const page  = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(100, parseInt(req.query.limit as string) || 50);

    // Sessions of this course that actually carry recordings. Recordings only
    // arrive after the stream ends, so ENDED (recovered) or READY (webhook).
    const query = {
      liveCourseIds: id,
      status: { $in: ["ENDED", "READY"] },
      "recordings.0": { $exists: true },
    };

    const [sessions, total] = await Promise.all([
      LiveSession.find(query)
        .sort({ scheduledAt: -1, createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .select("title status scheduledAt streamId recordings createdAt updatedAt")
        .lean(),
      LiveSession.countDocuments(query),
    ]);

    const subscribed = await hasAccessToAnyLiveCourse(req.user?.id, [id]);

    const lectures = sessions.map((s) => ({
      sessionId: String(s._id),
      title: s.title,
      status: s.status,
      streamId: s.streamId ?? null,
      scheduledAt: s.scheduledAt ?? null,
      // When the recording became available (session went READY / was updated).
      recordedAt: s.updatedAt ?? s.createdAt ?? null,
      // Available qualities only — never the mp4 paths. Playback URLs come
      // from the gated session-detail endpoint.
      qualities: Array.isArray(s.recordings)
        ? s.recordings.map((r) => r.quality).filter(Boolean)
        : [],
      recordingCount: Array.isArray(s.recordings) ? s.recordings.length : 0,
      locked: !subscribed,
    }));

    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name, image: course.image },
        subscribed,
        total,
        page,
        limit,
        lectures,
        purchaseOptions: subscribed ? [] : await buildPurchaseOptions([id]),
      },
      "Recorded live classes fetched."
    );
  } catch (err) {
    logger.error("Client live-course session recordings failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to list recorded live classes.", 500);
  }
};

// GET /api/v1/client/live-courses/my
// The customer's own live course subscriptions. ?status=active|expired|all
// (default all). Only verified subscriptions are returned — pending/failed
// payment attempts are an internal concern, not "my courses".
export const listMyLiveCourses = async (req: Request, res: Response) => {
  try {
    const customerId = req.user?.id;
    if (!customerId) return failure(res, "Unauthorized.", 401);

    const filterStatus =
      typeof req.query.status === "string" ? req.query.status : "all";
    const now = new Date();

    const query: Record<string, any> = { customerId, paymentStatus: "verified" };
    if (filterStatus === "active") {
      query.status = true;
      query.$or = [{ endAt: null }, { endAt: { $gte: now } }];
    } else if (filterStatus === "expired") {
      // Verified but no longer usable: switched off, or past its endAt.
      query.$or = [{ status: false }, { endAt: { $lt: now } }];
    }

    const subs = await LiveCourseSubscription.find(query)
      .sort({ createdAt: -1 })
      .populate("liveCourseId", "name image level isPaid status")
      .populate("planId", "name duration price")
      .lean();

    const liveCourses = subs.map((s) => {
      const active =
        s.status === true &&
        (s.endAt == null || new Date(s.endAt).getTime() >= now.getTime());
      return {
        subscriptionId: String(s._id),
        liveCourse: s.liveCourseId ?? null,
        plan: s.planId ?? null,
        startAt: s.startAt ?? null,
        endAt: s.endAt ?? null,
        paymentStatus: s.paymentStatus,
        active,
      };
    });

    return success(
      res,
      { liveCourses, total: liveCourses.length },
      "Your live courses fetched."
    );
  } catch (err) {
    logger.error("Client my-live-courses failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch your live courses.", 500);
  }
};

// GET /api/v1/client/live-courses/:id/schedule
// The Schedule tab: a study timetable derived from the course's scheduled
// LiveSessions (subject / educator / date / time slot), plus the course's
// uploaded "Time Table" files. Not entitlement-gated — it's course info shown
// to everyone so they can see what the course covers. ?upcoming=true limits
// to classes from now onward.
export const getLiveCourseSchedule = async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id ?? "");
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return failure(res, "Invalid live course id.", 422);
    }

    const course = await LiveCourse.findOne({ _id: id, status: true })
      .select("_id name timetableFiles")
      .lean();
    if (!course) return failure(res, "Live course not found.", 404);

    // Only sessions that carry a scheduledAt belong on a timetable.
    const query: Record<string, any> = { liveCourseIds: id, scheduledAt: { $ne: null } };
    if (req.query.upcoming === "true") {
      query.scheduledAt = { $ne: null, $gte: new Date() };
    }

    const sessions = await LiveSession.find(query)
      .sort({ scheduledAt: 1 })
      .select("title subject educatorId scheduledAt endAt status streamId")
      .populate("educatorId", "name image")
      .lean();

    const timetable = sessions.map((s) => ({
      sessionId: String(s._id),
      // `subject` falls back to the session title when not separately set.
      subject: s.subject || s.title,
      title: s.title,
      educator: s.educatorId ?? null, // populated { _id, name, image } or null
      date: s.scheduledAt ?? null,
      startAt: s.scheduledAt ?? null,
      endAt: s.endAt ?? null,
      status: s.status,
      streamId: s.streamId ?? null,
    }));

    const files = (course.timetableFiles ?? [])
      .slice()
      .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0));

    return success(
      res,
      {
        liveCourse: { _id: String(course._id), name: course.name },
        files,
        timetable,
        total: timetable.length,
      },
      "Schedule fetched."
    );
  } catch (err) {
    logger.error("Client live-course schedule failed", { error: getErrorMessage(err) });
    return failure(res, "Failed to fetch schedule.", 500);
  }
};
