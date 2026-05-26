import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Course } from "../../models/course/Course.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import { VideoCategoryRelation } from "../../models/course/VideoCategoryRelation.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { computeDaysLeft } from "../../utils/planDuration";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const progressSchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24), // sanity cap: 24h
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
  // Active container the user is watching from. Optional for back-compat
  // with older app builds — when omitted, the legacy ancestor-walk path
  // runs and a (legacy, scopeKind=null) row is written exactly like before.
  scope: z
    .object({
      kind: z.enum(["course", "liveCourse", "package"]),
      id: objectId,
    })
    .optional(),
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

    // Resolve the video's course via VideoCategory, so we can store courseId
    // on the progress row (denormalised for fast per-course rollups later).
    const video = await Video.findById(videoId).select("videoCategoryId status priceType").lean();
    if (!video || !video.status) {
      logger.warn("reportLectureProgress video not found", { traceId, userId, videoId });
      return res.status(404).json({ success: false, message: "Lecture not found." });
    }
    const category = await VideoCategory.findById(video.videoCategoryId)
      .select("courseId")
      .lean();
    const courseId = category?.courseId ?? null;

    // ─── New per-scope write path ────────────────────────────────────────
    // Frontend tells us which container the user is currently watching
    // from. We verify entitlement for *that* scope only and upsert a row
    // keyed on (customer, video, scope). Same video watched under two
    // different containers => two independent rows => independent
    // position+completion per container.
    if (scope) {
      const now = new Date();
      const cid = new mongoose.Types.ObjectId(userId);
      const scopeObjId = new mongoose.Types.ObjectId(scope.id);
      const isFree = (video as any).priceType === "free";

      let entitled = isFree;
      if (!entitled) {
        if (scope.kind === "course") {
          // Either direct course sub OR package sub whose target package
          // includes the video — both satisfy the course scope.
          const sub = await PackageCourseSubscription.findOne({
            customerId: cid,
            courseId: scopeObjId,
            status: true,
            paymentStatus: "verified",
            endAt: { $gt: now },
          })
            .select("_id")
            .lean();
          entitled = !!sub;
        } else if (scope.kind === "liveCourse") {
          const sub = await LiveCourseSubscription.findOne({
            customerId: cid,
            liveCourseId: scopeObjId,
            status: true,
            paymentStatus: "verified",
            endAt: { $gt: now },
          })
            .select("_id")
            .lean();
          entitled = !!sub;
        } else {
          // package
          const sub = await PackageCourseSubscription.findOne({
            customerId: cid,
            targetPackageId: scopeObjId,
            status: true,
            paymentStatus: "verified",
            endAt: { $gt: now },
          })
            .select("_id")
            .lean();
          entitled = !!sub;
        }
      }

      if (!entitled) {
        logger.warn("reportLectureProgress scoped entitlement failed", {
          traceId, userId, videoId, scope,
        });
        return res.status(403).json({
          success: false,
          message: "No active subscription for this scope.",
        });
      }

      const completedNow =
        durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;

      const setFields: any = {
        positionSec,
        durationSec,
        lastWatchedAt: now,
        scopeKind: scope.kind,
        // Only the matching parent pointer is set; the other two stay null
        // on a per-scope row so reads filtering by scopeKind never see a
        // cross-container leak.
        courseId:     scope.kind === "course"     ? scopeObjId : null,
        liveCourseId: scope.kind === "liveCourse" ? scopeObjId : null,
        packageId:    scope.kind === "package"    ? scopeObjId : null,
      };
      if (completedNow) {
        setFields.completed = true;
        setFields.completedAt = now;
      }

      const filter: any = {
        customerId: cid,
        videoId: new mongoose.Types.ObjectId(videoId),
        scopeKind: scope.kind,
      };
      // Include the scope id in the filter so the partial-unique index
      // (customerId, videoId, courseId|liveCourseId|packageId) matches.
      if (scope.kind === "course")     filter.courseId     = scopeObjId;
      if (scope.kind === "liveCourse") filter.liveCourseId = scopeObjId;
      if (scope.kind === "package")    filter.packageId    = scopeObjId;

      const row = await LectureProgress.findOneAndUpdate(
        filter,
        {
          $set: setFields,
          $setOnInsert: {
            customerId: cid,
            videoId: new mongoose.Types.ObjectId(videoId),
          },
        },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );

      logger.info("reportLectureProgress scoped success", {
        traceId, userId, videoId, scope, completedNow,
      });
      return res.status(200).json({ success: true, data: row });
    }
    // ─── End per-scope write path ────────────────────────────────────────

    // Resolve which "container(s)" this lecture sits under for rollup. A video
    // category is the leaf; walk parents via VideoCategoryRelation to find:
    //   - the package(s) it's reachable through (PackageVideoCategoryRelation)
    //   - the live course it belongs to (LiveCourse.videoCategoryId matches
    //     this leaf or any ancestor)
    // The walk is bounded — most trees are 2-3 levels deep.
    const ancestorIds: any[] = [];
    if (video.videoCategoryId) {
      ancestorIds.push(video.videoCategoryId);
      let cursorIds: any[] = [video.videoCategoryId];
      for (let depth = 0; depth < 5 && cursorIds.length; depth++) {
        const parents = await VideoCategoryRelation.find({
          child: { $in: cursorIds },
        })
          .select("parent")
          .lean();
        cursorIds = parents.map((p) => p.parent);
        for (const pid of cursorIds) ancestorIds.push(pid);
      }
    }

    const liveCourse = ancestorIds.length
      ? await LiveCourse.findOne({
          videoCategoryId: { $in: ancestorIds },
          status: true,
        })
          .select("_id")
          .lean()
      : null;

    // PackageVideoCategoryRelation links via VideoCategoryRelation rows, not
    // raw category ids — resolve the relation rows first, then the packages.
    let packageIds: any[] = [];
    if (ancestorIds.length) {
      const relRows = await VideoCategoryRelation.find({
        child: { $in: ancestorIds },
      })
        .select("_id")
        .lean();
      if (relRows.length) {
        const pkgRows = await PackageVideoCategoryRelation.find({
          videoCategoryRelationId: { $in: relRows.map((r) => r._id) },
          active: true,
        })
          .select("packageId")
          .lean();
        packageIds = [...new Set(pkgRows.map((p) => String(p.packageId)))].map(
          (s) => new mongoose.Types.ObjectId(s)
        );
      }
    }

    // Entitlement gate. The user must hold *one* active, verified, non-expired
    // subscription that covers this lecture — direct course sub, package sub
    // that includes the course, or a live-course sub for the live course this
    // lecture's folder belongs to.
    const now = new Date();
    const cid = new mongoose.Types.ObjectId(userId);
    const orGates: any[] = [];
    if (courseId) orGates.push({ courseId });
    if (packageIds.length) orGates.push({ targetPackageId: { $in: packageIds } });

    const isFree = (video as any).priceType === "free";

    const [pkgSub, liveSub] = await Promise.all([
      orGates.length
        ? PackageCourseSubscription.findOne({
            customerId: cid,
            status: true,
            paymentStatus: "verified",
            endAt: { $gt: now },
            $or: orGates,
          })
            .select("courseId targetPackageId")
            .lean()
        : Promise.resolve(null as any),
      liveCourse
        ? LiveCourseSubscription.findOne({
            customerId: cid,
            liveCourseId: liveCourse._id,
            status: true,
            paymentStatus: "verified",
            endAt: { $gt: now },
          })
            .select("_id")
            .lean()
        : Promise.resolve(null as any),
    ]);

    if (!isFree && !pkgSub && !liveSub) {
      logger.warn("reportLectureProgress no active subscription", { traceId, userId, videoId, courseId, packageIds });
      return res.status(403).json({
        success: false,
        message: "No active subscription for this lecture.",
      });
    }

    const completedNow =
      durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;

    // We never *un*complete a lecture — once completed: true, it stays true even
    // if a later heartbeat reports an earlier position (user re-watched the start).
    // Denormalise every container the user could see this lecture under so the
    // unified /learning/progress/my read does not have to re-walk the tree.
    const setFields: any = {
      positionSec,
      durationSec,
      lastWatchedAt: now,
    };
    if (courseId) setFields.courseId = courseId;
    if (pkgSub?.targetPackageId) setFields.packageId = pkgSub.targetPackageId;
    if (liveCourse?._id) setFields.liveCourseId = liveCourse._id;

    const update: any = {
      $set: setFields,
      $setOnInsert: {
        customerId: cid,
        videoId: new mongoose.Types.ObjectId(videoId),
      },
    };
    if (completedNow) {
      update.$set.completed = true;
      update.$set.completedAt = now;
    }

    const row = await LectureProgress.findOneAndUpdate(
      { customerId: userId, videoId },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    logger.info("reportLectureProgress success", { traceId, userId, videoId, positionSec, durationSec, completedNow });
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
    const perCourse = await LectureProgress.aggregate([
      { $match: { customerId: cid } },
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
