import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";
import { resolveScopedReachableVideoCategoryIds } from "./scopeReachableCategories";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const progressSchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24), // sanity cap: 24h
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
  // Container the user is watching from. REQUIRED: progress is stored per
  // (customer, video, container), so we cannot persist a heartbeat without
  // knowing which product the row belongs to. The same video watched from
  // two packages keeps two independent rows — `scope` is what tells them
  // apart. `scope.id` must be the top-level product the user opened (Course /
  // Package / Live Course), never a video-category id.
  scope: z.object({
    kind: z.enum(["course", "liveCourse", "package"]),
    id: objectId,
  }),
});

// A lecture is treated as completed once the user has watched ~95% of it.
// (Trailing credits / a missed last second shouldn't block the bar from filling.)
const COMPLETION_THRESHOLD = 0.95;

// POST /api/v1/client/courses/lectures/:videoId/progress
// Heartbeat from the mobile player. The first call for a (customer, video)
// pair upserts a new row — that's also what makes the course appear on the
// My Courses screen for the first time. No separate "start course" call.
export const reportLectureProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("reportLectureProgress invoked", { traceId, path: req.originalUrl, userId, videoId: req.params.videoId });

  try {
    if (!userId) {
      logger.warn("reportLectureProgress unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const videoId = objectId.parse(req.params.videoId);
    const { positionSec, durationSec, scope } = progressSchema.parse(req.body);

    const video = await Video.findById(videoId).select("videoCategoryId status priceType").lean();
    if (!video || !video.status) {
      logger.warn("reportLectureProgress video not found", { traceId, userId, videoId });
      return res.status(404).json({ success: false, message: "Lecture not found." });
    }

    const now = new Date();
    const cid = new mongoose.Types.ObjectId(userId);
    const scopeOid = new mongoose.Types.ObjectId(scope.id);
    const isFree = (video as any).priceType === "free";

    // Confirm the video is genuinely reachable from the scoped container by
    // asking the SAME question the catalog answers when it lists a video under
    // a product: walk the category tree DOWNWARD off every category the product
    // links (via childCategoryIds) and check whether the video's leaf category
    // falls inside that set. Using the catalog's own resolver keeps the two in
    // lockstep — a video listed under a product is always accepted for progress
    // there, even when it's shared across MORE THAN ONE product (its second
    // linkage is often expressed only through nested childCategoryIds, which the
    // old upward VideoCategoryRelation walk missed → a false "not part of"
    // 400). See resolveScopedReachableVideoCategoryIds.
    const reachableCategoryIds = await resolveScopedReachableVideoCategoryIds(
      scope.kind,
      scopeOid
    );
    const leafCategoryId = video.videoCategoryId
      ? String(video.videoCategoryId)
      : null;
    // A FREE video is exempt from the strict membership check (free content is
    // often surfaced via the free catalog rather than the product's linkage
    // tree, so the linkage may legitimately be absent). Paid videos must be
    // reachable. Each branch below still confirms the product exists / the user
    // is subscribed.
    const videoReachable =
      isFree || (!!leafCategoryId && reachableCategoryIds.has(leafCategoryId));

    // The container the row attaches to is decided ENTIRELY by `scope`. We
    // validate two things before trusting it: (1) the user is entitled to that
    // exact container (so a spoofed scope can't attach progress to something
    // unbought), and (2) the video is actually reachable under that container
    // (so progress can't be mis-filed onto an unrelated product the user does
    // happen to own). Only then do we stamp the single matching pointer.
    let courseId: any = null;
    let packageId: any = null;
    let liveCourseId: any = null;

    if (scope.kind === "course") {
      // Reachability decided by the shared catalog resolver above. A video can
      // legitimately belong to more than one course (shared categories); the
      // resolver expands the scoped course's linked roots downward and the leaf
      // membership test confirms THIS course is one of them.
      if (!videoReachable) {
        logger.warn("reportLectureProgress scope mismatch (course)", { traceId, userId, videoId, scope });
        return res.status(400).json({ success: false, message: "Video is not part of the scoped course." });
      }
      if (isFree) {
        const scopedCourse = await Course.findOne({ _id: scopeOid, status: true }).select("_id").lean();
        if (!scopedCourse) {
          return res.status(404).json({ success: false, message: "Course not found." });
        }
      } else {
        const sub = await PackageCourseSubscription.findOne({
          customerId: cid,
          courseId: scopeOid,
          status: true,
          paymentStatus: "verified",
          endAt: { $gt: now },
        }).select("_id").lean();
        if (!sub) {
          logger.warn("reportLectureProgress no active subscription (course)", { traceId, userId, videoId, scope });
          return res.status(403).json({ success: false, message: "No active subscription for this lecture." });
        }
      }
      courseId = scopeOid;
    } else if (scope.kind === "package") {
      // Reachability decided by the shared catalog resolver above, which expands
      // BOTH package linkage forms (specificSubjects roots + the
      // PackageVideoCategoryRelation tree, both relation endpoints) downward via
      // childCategoryIds — exactly how the catalog lists package videos. The leaf
      // membership test then confirms the video is inside THIS package, even when
      // it is shared across multiple packages.
      if (!videoReachable) {
        logger.warn("reportLectureProgress scope mismatch (package)", { traceId, userId, videoId, scope });
        return res.status(400).json({ success: false, message: "Video is not part of the scoped package." });
      }
      // Free videos inside a paid package are watchable without purchasing it,
      // so their progress must persist too — only confirm the package exists.
      // Paid videos still require an active subscription. (Mirrors the `course`
      // scope rule above.)
      if (isFree) {
        const scopedPackage = await Package.findOne({ _id: scopeOid, active: true }).select("_id").lean();
        if (!scopedPackage) {
          return res.status(404).json({ success: false, message: "Package not found." });
        }
      } else {
        const sub = await PackageCourseSubscription.findOne({
          customerId: cid,
          targetPackageId: scopeOid,
          status: true,
          paymentStatus: "verified",
          endAt: { $gt: now },
        }).select("_id").lean();
        if (!sub) {
          logger.warn("reportLectureProgress no active subscription (package)", { traceId, userId, videoId, scope });
          return res.status(403).json({ success: false, message: "No active subscription for this lecture." });
        }
      }
      packageId = scopeOid;
    } else {
      // liveCourse — reachability decided by the shared catalog resolver above,
      // which expands both linkage forms (categories carrying liveCourseId + the
      // course's downward videoCategoryId root) downward via childCategoryIds,
      // matching how the recordings list resolves a live course's videos. The
      // leaf membership test then confirms the video is inside THIS live course.
      if (!videoReachable) {
        logger.warn("reportLectureProgress scope mismatch (liveCourse)", { traceId, userId, videoId, scope });
        return res.status(400).json({ success: false, message: "Video is not part of the scoped live course." });
      }
      // Free recorded lectures inside a paid live course are watchable without
      // purchasing it, so their progress must persist too — only confirm the
      // live course exists. Paid lectures still require an active subscription.
      // (Mirrors the `course` scope rule above.)
      if (isFree) {
        const scopedLiveCourse = await LiveCourse.findOne({ _id: scopeOid, status: true }).select("_id").lean();
        if (!scopedLiveCourse) {
          return res.status(404).json({ success: false, message: "Live course not found." });
        }
      } else {
        const sub = await LiveCourseSubscription.findOne({
          customerId: cid,
          liveCourseId: scopeOid,
          status: true,
          paymentStatus: "verified",
          endAt: { $gt: now },
        }).select("_id").lean();
        if (!sub) {
          logger.warn("reportLectureProgress no active subscription (liveCourse)", { traceId, userId, videoId, scope });
          return res.status(403).json({ success: false, message: "No active subscription for this lecture." });
        }
      }
      liveCourseId = scopeOid;
    }

    const completedNow =
      durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;

    // We never *un*complete a lecture — once completed: true, it stays true even
    // if a later heartbeat reports an earlier position (user re-watched the start).
    // Progress is GLOBAL per (customer, video): the same video reached through
    // multiple products shares one row (see LectureProgress model + the unique
    // `uniq_customer_video` index). The container pointer for the product the user
    // is watching from is stamped via $set so the rollups still attribute it; we
    // only ever ADD a pointer (never clear another product's), so a video watched
    // under Course A then Package X ends with both courseId and packageId set.
    const setFields: any = {
      positionSec,
      durationSec,
      lastWatchedAt: now,
    };
    // Stamp only the pointer for the current scope — leave the others untouched
    // so a prior container's attribution survives.
    if (courseId) setFields.courseId = courseId;
    if (packageId) setFields.packageId = packageId;
    if (liveCourseId) setFields.liveCourseId = liveCourseId;
    if (completedNow) {
      setFields.completed = true;
      setFields.completedAt = now;
    }

    const row = await LectureProgress.findOneAndUpdate(
      {
        customerId: cid,
        videoId: new mongoose.Types.ObjectId(videoId),
      },
      {
        $set: setFields,
        $setOnInsert: {
          customerId: cid,
          videoId: new mongoose.Types.ObjectId(videoId),
        },
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    logger.info("reportLectureProgress success", { traceId, userId, videoId, scope, positionSec, durationSec, completedNow });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    if (e.issues) {
      logger.warn("reportLectureProgress validation failed", { traceId, userId, issues: e.issues });
      return res.status(400).json({ success: false, errors: e.issues });
    }
    logger.error("reportLectureProgress failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// GET /api/v1/client/courses/my
// Drives the "My Courses / Subject" screen. Returns:
//   - `courses`: the user's *started* courses (any LectureProgress row exists),
//      each annotated with daysLeft, percentCompleted, and the most recently-
//      watched lecture for the small per-card progress hint.
//   - `resumeNext`: the single most recently-watched lecture across all the
//      user's courses, expanded for the big "Resume Now" hero card.
//
// Untouched courses (subscribed but never opened) are intentionally excluded —
// that matches the design (100 enrolled, only 3 shown).
export const listMyCoursesForResume = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMyCoursesForResume invoked", { traceId, path: req.originalUrl, userId });

  try {
    if (!userId) {
      logger.warn("listMyCoursesForResume unauthorized", { traceId });
      return res.status(401).json({ success: false, message: "Unauthorized." });
    }

    const cid = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    // Group progress rows by course; pick the latest activity per course.
    // Only course-container rows carry a courseId now (package / live-course
    // rows live under their own pointer), so scope the match to them.
    const perCourse = await LectureProgress.aggregate([
      { $match: { customerId: cid, courseId: { $ne: null } } },
      { $sort: { lastWatchedAt: -1 } },
      {
        $group: {
          _id: "$courseId",
          lastWatchedAt: { $first: "$lastWatchedAt" },
          lastVideoId: { $first: "$videoId" },
          lastPositionSec: { $first: "$positionSec" },
          lastDurationSec: { $first: "$durationSec" },
          completedCount: { $sum: { $cond: ["$completed", 1, 0] } },
        },
      },
      { $sort: { lastWatchedAt: -1 } },
      { $limit: 20 }, // cap — this is a "recent activity" list, not exhaustive history
    ]);

    if (perCourse.length === 0) {
      logger.info("listMyCoursesForResume empty", { traceId, userId });
      return res.status(200).json({
        success: true,
        data: { courses: [], resumeNext: null },
      });
    }

    const courseIds = perCourse.map((p) => p._id);

    // Three parallel reads to flesh out each course card:
    //  1. Course metadata (name, thumbnail, educator, etc.)
    //  2. Active subscription per course → daysLeft
    //  3. Total lectures per course → denominator for the % bar
    const [courses, subs, lectureCounts] = await Promise.all([
      Course.find({ _id: { $in: courseIds }, status: true })
        .select("_id name thumbnail image author")
        .lean(),
      PackageCourseSubscription.find({
        customerId: cid,
        courseId: { $in: courseIds },
        status: true,
        paymentStatus: "verified",
        endAt: { $gt: now },
      })
        .select("courseId endAt")
        .lean(),
      VideoCategory.aggregate([
        { $match: { courseId: { $in: courseIds }, status: true } },
        {
          $lookup: {
            from: "ws_videos",
            let: { categoryId: "$_id" },
            pipeline: [
              {
                $match: {
                  $expr: { $eq: ["$videoCategoryId", "$$categoryId"] },
                  status: true,
                },
              },
              { $count: "n" },
            ],
            as: "videos",
          },
        },
        {
          $group: {
            _id: "$courseId",
            total: { $sum: { $ifNull: [{ $first: "$videos.n" }, 0] } },
          },
        },
      ]),
    ]);

    const courseById = new Map(courses.map((c: any) => [String(c._id), c]));
    const subByCourse = new Map(subs.map((s: any) => [String(s.courseId), s]));
    const totalByCourse = new Map(lectureCounts.map((r: any) => [String(r._id), r.total]));

    const courseCards = perCourse
      .map((p) => {
        const course = courseById.get(String(p._id));
        if (!course) return null; // course was deleted/disabled — skip
        const sub = subByCourse.get(String(p._id));
        const total = totalByCourse.get(String(p._id)) ?? 0;
        const daysLeft = computeDaysLeft(sub?.endAt ?? null, now);
        const percent = total > 0 ? Math.min(100, Math.round((p.completedCount / total) * 100)) : 0;
        return {
          course,
          daysLeft,
          percentCompleted: percent,
          completedLectures: p.completedCount,
          totalLectures: total,
          lastWatchedAt: p.lastWatchedAt,
          lastVideoId: p.lastVideoId,
        };
      })
      .filter(Boolean);

    // The hero "Resume Now" card. We expand the *single* most recent lecture
    // across all courses and include enough metadata to render the big card
    // without a follow-up call.
    const top = perCourse[0];
    let resumeNext: any = null;
    if (top) {
      const [lastVideo, lastCourse] = await Promise.all([
        Video.findById(top.lastVideoId).select("title topic order videoCategoryId").lean(),
        Course.findById(top._id).select("_id name thumbnail").lean(),
      ]);
      if (lastVideo && lastCourse) {
        const remainingSec = Math.max(0, top.lastDurationSec - top.lastPositionSec);
        const lecturePercent =
          top.lastDurationSec > 0
            ? Math.min(100, Math.round((top.lastPositionSec / top.lastDurationSec) * 100))
            : 0;
        resumeNext = {
          course: lastCourse,
          lecture: {
            _id: lastVideo._id,
            title: lastVideo.title,
            topic: lastVideo.topic,
          },
          lastWatchedAt: top.lastWatchedAt,
          positionSec: top.lastPositionSec,
          durationSec: top.lastDurationSec,
          remainingSec,
          percent: lecturePercent,
        };
      }
    }

    logger.info("listMyCoursesForResume success", { traceId, userId, courseCount: courseCards.length, hasResume: !!resumeNext });
    return res.status(200).json({
      success: true,
      data: { courses: courseCards, resumeNext },
    });
  } catch (e: any) {
    logger.error("listMyCoursesForResume failed", { traceId, userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
