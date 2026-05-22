import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Course } from "../../models/course/Course.model";
import { Package } from "../../models/course/Package.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { PackageVideoCategoryRelation } from "../../models/course/PackageVideoCategoryRelation.model";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const progressBodySchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24),
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
});

// A lecture is treated as completed once the user has watched ~95% of it.
const COMPLETION_THRESHOLD = 0.95;

// ---------------------------------------------------------------------------
// POST /api/v1/client/learning/progress/live-sessions/:liveSessionId
// Heartbeat for a recorded live session playback. Mirrors the video heartbeat:
// upserts a (customer, liveSessionId) row, gated on an active live-course
// subscription for at least one course the session is published under.
// ---------------------------------------------------------------------------
export const reportLiveSessionProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("reportLiveSessionProgress invoked", { traceId, path: req.originalUrl, customerId: userId, liveSessionId: req.params.liveSessionId });

  try {
    if (!userId) { logger.warn("reportLiveSessionProgress unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const liveSessionId = objectId.parse(req.params.liveSessionId);
    const { positionSec, durationSec } = progressBodySchema.parse(req.body);

    const session = await LiveSession.findById(liveSessionId)
      .select("liveCourseIds status")
      .lean();
    if (!session || !session.liveCourseIds?.length) {
      logger.warn("reportLiveSessionProgress session not found", { traceId, customerId: userId, liveSessionId });
      return res.status(404).json({ success: false, message: "Live session not found." });
    }

    const now = new Date();
    const cid = new mongoose.Types.ObjectId(userId);

    // Any one of the session's live courses being entitled is enough. Pick
    // the first matching sub for the denormalised liveCourseId pointer.
    const sub = await LiveCourseSubscription.findOne({
      customerId: cid,
      liveCourseId: { $in: session.liveCourseIds },
      status: true,
      paymentStatus: "verified",
      endAt: { $gt: now },
    })
      .select("liveCourseId")
      .lean();
    if (!sub) {
      logger.warn("reportLiveSessionProgress no active subscription", { traceId, customerId: userId, liveSessionId });
      return res.status(403).json({
        success: false,
        message: "No active subscription for this live course.",
      });
    }

    const completedNow =
      durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;

    const update: any = {
      $set: {
        liveCourseId: sub.liveCourseId,
        positionSec,
        durationSec,
        lastWatchedAt: now,
      },
      $setOnInsert: {
        customerId: cid,
        liveSessionId: new mongoose.Types.ObjectId(liveSessionId),
      },
    };
    if (completedNow) {
      update.$set.completed = true;
      update.$set.completedAt = now;
    }

    const row = await LectureProgress.findOneAndUpdate(
      { customerId: cid, liveSessionId: new mongoose.Types.ObjectId(liveSessionId) },
      update,
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    logger.info("reportLiveSessionProgress success", { traceId, customerId: userId, liveSessionId, completedNow });
    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    if (e.issues) { logger.warn("reportLiveSessionProgress validation failed", { traceId, customerId: userId, issues: e.issues }); return res.status(400).json({ success: false, errors: e.issues }); }
    logger.error("reportLiveSessionProgress failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};

// ---------------------------------------------------------------------------
// GET /api/v1/client/learning/progress/my
// Unified "Resume Learning" feed. Returns one flat list of cards covering
// Course, Package and Live Course entries the user has actually started
// (i.e. has at least one LectureProgress row for). The list is sorted by
// most-recent activity across all three types so the FE renders them as one
// vertical stream — matching the UI in the design.
// ---------------------------------------------------------------------------
export const listMyLearningProgress = async (req: Request, res: Response) => {
  const traceId = req.traceId;
  const userId = req.user?.id;
  logger.info("listMyLearningProgress invoked", { traceId, path: req.originalUrl, customerId: userId });

  try {
    if (!userId) { logger.warn("listMyLearningProgress unauthorized", { traceId }); return res.status(401).json({ success: false, message: "Unauthorized." }); }

    const cid = new mongoose.Types.ObjectId(userId);
    const now = new Date();

    // Three parallel rollups — by courseId, by packageId, by liveCourseId.
    // Each row is one card on the FE.
    const [perCourse, perPackage, perLive] = await Promise.all([
      LectureProgress.aggregate([
        { $match: { customerId: cid, courseId: { $ne: null }, packageId: null } },
        { $sort: { lastWatchedAt: -1 } },
        {
          $group: {
            _id: "$courseId",
            lastWatchedAt:  { $first: "$lastWatchedAt" },
            lastVideoId:    { $first: "$videoId" },
            lastPositionSec:{ $first: "$positionSec" },
            lastDurationSec:{ $first: "$durationSec" },
            completedCount: { $sum: { $cond: ["$completed", 1, 0] } },
          },
        },
      ]),
      LectureProgress.aggregate([
        { $match: { customerId: cid, packageId: { $ne: null } } },
        { $sort: { lastWatchedAt: -1 } },
        {
          $group: {
            _id: "$packageId",
            lastWatchedAt:  { $first: "$lastWatchedAt" },
            lastVideoId:    { $first: "$videoId" },
            lastCourseId:   { $first: "$courseId" },
            lastPositionSec:{ $first: "$positionSec" },
            lastDurationSec:{ $first: "$durationSec" },
            completedCount: { $sum: { $cond: ["$completed", 1, 0] } },
          },
        },
      ]),
      LectureProgress.aggregate([
        { $match: { customerId: cid, liveCourseId: { $ne: null } } },
        { $sort: { lastWatchedAt: -1 } },
        {
          $group: {
            _id: "$liveCourseId",
            lastWatchedAt:    { $first: "$lastWatchedAt" },
            lastVideoId:      { $first: "$videoId" },
            lastLiveSessionId:{ $first: "$liveSessionId" },
            lastPositionSec:  { $first: "$positionSec" },
            lastDurationSec:  { $first: "$durationSec" },
            completedCount:   { $sum: { $cond: ["$completed", 1, 0] } },
          },
        },
      ]),
    ]);

    const courseIds  = perCourse.map((r) => r._id);
    const packageIds = perPackage.map((r) => r._id);
    const liveIds    = perLive.map((r) => r._id);

    // Fetch the metadata + entitlement rows for every container in parallel.
    const [courses, packages, liveCourses, courseSubs, packageSubs, liveSubs] =
      await Promise.all([
        courseIds.length
          ? Course.find({ _id: { $in: courseIds }, status: true })
              .select("_id name image courseEducatorId")
              .populate({ path: "courseEducatorId", model: CourseEducator, select: "name image" })
              .lean()
          : [],
        packageIds.length
          ? Package.find({ _id: { $in: packageIds }, active: true })
              .select("_id name image educatorId")
              .populate({ path: "educatorId", model: CourseEducator, select: "name image" })
              .lean()
          : [],
        liveIds.length
          ? LiveCourse.find({ _id: { $in: liveIds }, status: true })
              .select("_id name image courseEducatorId")
              .populate({ path: "courseEducatorId", model: CourseEducator, select: "name image" })
              .lean()
          : [],
        courseIds.length
          ? PackageCourseSubscription.find({
              customerId: cid,
              courseId: { $in: courseIds },
              status: true,
              paymentStatus: "verified",
              endAt: { $gt: now },
            })
              .select("courseId endAt")
              .lean()
          : [],
        packageIds.length
          ? PackageCourseSubscription.find({
              customerId: cid,
              targetPackageId: { $in: packageIds },
              status: true,
              paymentStatus: "verified",
              endAt: { $gt: now },
            })
              .select("targetPackageId endAt")
              .lean()
          : [],
        liveIds.length
          ? LiveCourseSubscription.find({
              customerId: cid,
              liveCourseId: { $in: liveIds },
              status: true,
              paymentStatus: "verified",
              endAt: { $gt: now },
            })
              .select("liveCourseId endAt")
              .lean()
          : [],
      ]);

    // Totals (denominator for the % bar) — count published lectures per
    // container. For courses and packages this is the count of active Videos
    // under the container's video tree. For live courses it's the count of
    // live sessions published under it.
    const [courseTotals, packageTotals, liveTotals] = await Promise.all([
      courseIds.length
        ? VideoCategory.aggregate([
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
          ])
        : [],
      // Per-package totals are expensive to compute exactly (walk the
      // package → relation → category → videos tree) and the FE only needs a
      // reasonable bar. We compute it as: total videos under any category
      // reachable from the package's relations.
      packageIds.length
        ? PackageVideoCategoryRelation.aggregate([
              { $match: { packageId: { $in: packageIds }, active: true } },
              {
                $lookup: {
                  from: "videocategoryrelations",
                  localField: "videoCategoryRelationId",
                  foreignField: "_id",
                  as: "rel",
                },
              },
              { $unwind: "$rel" },
              {
                $lookup: {
                  from: "ws_videos",
                  let: { catId: "$rel.child" },
                  pipeline: [
                    {
                      $match: {
                        $expr: { $eq: ["$videoCategoryId", "$$catId"] },
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
                  _id: "$packageId",
                  total: { $sum: { $ifNull: [{ $first: "$videos.n" }, 0] } },
                },
              },
            ])
        : [],
      liveIds.length
        ? LiveSession.aggregate([
            { $match: { liveCourseIds: { $in: liveIds } } },
            { $unwind: "$liveCourseIds" },
            { $match: { liveCourseIds: { $in: liveIds } } },
            { $group: { _id: "$liveCourseIds", total: { $sum: 1 } } },
          ])
        : [],
    ]);

    const courseById  = new Map(courses.map((c: any) => [String(c._id), c]));
    const packageById = new Map(packages.map((p: any) => [String(p._id), p]));
    const liveById    = new Map(liveCourses.map((l: any) => [String(l._id), l]));
    const courseSubBy  = new Map(courseSubs.map((s: any)  => [String(s.courseId), s]));
    const packageSubBy = new Map(packageSubs.map((s: any) => [String(s.targetPackageId), s]));
    const liveSubBy    = new Map(liveSubs.map((s: any)    => [String(s.liveCourseId), s]));
    const courseTotalBy  = new Map(courseTotals.map((r: any)  => [String(r._id), r.total]));
    const packageTotalBy = new Map(packageTotals.map((r: any) => [String(r._id), r.total]));
    const liveTotalBy    = new Map(liveTotals.map((r: any)    => [String(r._id), r.total]));

    const daysLeftOf = (endAt?: Date | null) =>
      endAt ? Math.max(0, Math.ceil((new Date(endAt).getTime() - now.getTime()) / 86_400_000)) : null;

    const percentOf = (done: number, total: number) =>
      total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

    const educatorOf = (e: any) =>
      e && e._id
        ? { id: String(e._id), name: e.name ?? null, image: e.image ?? null }
        : null;

    // Batch-fetch every resume lecture (video + live session) upfront so each
    // card carries its own `lecture` object — the FE can render the tap target
    // ("Resume Learning") without a follow-up call.
    const allVideoIds = [
      ...perCourse.map((p) => p.lastVideoId),
      ...perPackage.map((p) => p.lastVideoId),
      ...perLive.map((p) => p.lastVideoId),
    ].filter(Boolean);
    const allSessionIds = perLive.map((p) => p.lastLiveSessionId).filter(Boolean);
    const [videoRows, sessionRows] = await Promise.all([
      allVideoIds.length
        ? Video.find({ _id: { $in: allVideoIds } })
            .select("title topic videoCategoryId")
            .lean()
        : [],
      allSessionIds.length
        ? LiveSession.find({ _id: { $in: allSessionIds } }).select("title subject").lean()
        : [],
    ]);
    const videoById = new Map(videoRows.map((v: any) => [String(v._id), v]));
    const sessionById = new Map(sessionRows.map((s: any) => [String(s._id), s]));

    // Resolve the chapter (VideoCategory) titles so the FE can show "Chapter > Lecture"
    // and scroll to / highlight the chapter inside the Course screen on tap.
    const lectureCategoryIds = videoRows
      .map((v: any) => v.videoCategoryId)
      .filter(Boolean);
    const categoryRows = lectureCategoryIds.length
      ? await VideoCategory.find({ _id: { $in: lectureCategoryIds } })
          .select("_id title")
          .lean()
      : [];
    const categoryById = new Map(categoryRows.map((c: any) => [String(c._id), c]));

    const lectureFromVideo = (id: any) => {
      if (!id) return null;
      const v = videoById.get(String(id));
      if (!v) return null;
      const cat = v.videoCategoryId
        ? categoryById.get(String(v.videoCategoryId))
        : null;
      return {
        _id: String(v._id),
        title: v.title,
        topic: v.topic ?? null,
        videoCategoryId: v.videoCategoryId ? String(v.videoCategoryId) : null,
        chapterTitle: cat?.title ?? null,
      };
    };
    const lectureFromSession = (id: any) => {
      if (!id) return null;
      const s = sessionById.get(String(id));
      return s
        ? {
            _id: String(s._id),
            title: s.title,
            topic: s.subject ?? null,
            videoCategoryId: null,
            chapterTitle: null,
          }
        : null;
    };

    const cards: any[] = [];

    for (const p of perCourse) {
      const c = courseById.get(String(p._id));
      if (!c) continue;
      const sub = courseSubBy.get(String(p._id));
      const total = courseTotalBy.get(String(p._id)) ?? 0;
      cards.push({
        type: "course",
        id: String(c._id),
        courseId: String(c._id),
        liveCourseId: null,
        packageId: null,
        title: c.name,
        subtitle: c.courseEducatorId?.name ? `By ${c.courseEducatorId.name}` : null,
        educator: educatorOf(c.courseEducatorId),
        thumbnail: c.image ?? null,
        daysLeft: daysLeftOf(sub?.endAt),
        subscriptionEndAt: sub?.endAt ?? null,
        percentCompleted: percentOf(p.completedCount, total),
        completedLectures: p.completedCount,
        totalLectures: total,
        lastWatchedAt: p.lastWatchedAt,
        lecture: lectureFromVideo(p.lastVideoId),
        resume: {
          videoId: p.lastVideoId ? String(p.lastVideoId) : null,
          liveSessionId: null,
          positionSec: p.lastPositionSec,
          durationSec: p.lastDurationSec,
        },
      });
    }

    for (const p of perPackage) {
      const pkg = packageById.get(String(p._id));
      if (!pkg) continue;
      const sub = packageSubBy.get(String(p._id));
      const total = packageTotalBy.get(String(p._id)) ?? 0;
      cards.push({
        type: "package",
        id: String(pkg._id),
        packageId: String(pkg._id),
        courseId: p.lastCourseId ? String(p.lastCourseId) : null,
        liveCourseId: null,
        title: pkg.name,
        subtitle: pkg.educatorId?.name ? `By ${pkg.educatorId.name}` : null,
        educator: educatorOf(pkg.educatorId),
        thumbnail: pkg.image ?? null,
        daysLeft: daysLeftOf(sub?.endAt),
        subscriptionEndAt: sub?.endAt ?? null,
        percentCompleted: percentOf(p.completedCount, total),
        completedLectures: p.completedCount,
        totalLectures: total,
        lastWatchedAt: p.lastWatchedAt,
        lecture: lectureFromVideo(p.lastVideoId),
        resume: {
          videoId: p.lastVideoId ? String(p.lastVideoId) : null,
          liveSessionId: null,
          positionSec: p.lastPositionSec,
          durationSec: p.lastDurationSec,
        },
      });
    }

    for (const p of perLive) {
      const lc = liveById.get(String(p._id));
      if (!lc) continue;
      const sub = liveSubBy.get(String(p._id));
      const total = liveTotalBy.get(String(p._id)) ?? 0;
      cards.push({
        type: "live",
        id: String(lc._id),
        liveCourseId: String(lc._id),
        courseId: null,
        packageId: null,
        title: lc.name,
        subtitle: lc.courseEducatorId?.name ? `By ${lc.courseEducatorId.name}` : null,
        educator: educatorOf(lc.courseEducatorId),
        thumbnail: lc.image ?? null,
        daysLeft: daysLeftOf(sub?.endAt),
        subscriptionEndAt: sub?.endAt ?? null,
        percentCompleted: percentOf(p.completedCount, total),
        completedLectures: p.completedCount,
        totalLectures: total,
        lastWatchedAt: p.lastWatchedAt,
        lecture:
          lectureFromSession(p.lastLiveSessionId) ?? lectureFromVideo(p.lastVideoId),
        resume: {
          videoId: p.lastVideoId ? String(p.lastVideoId) : null,
          liveSessionId: p.lastLiveSessionId ? String(p.lastLiveSessionId) : null,
          positionSec: p.lastPositionSec,
          durationSec: p.lastDurationSec,
        },
      });
    }

    cards.sort(
      (a, b) =>
        new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime()
    );

    // The hero "Resume Now" card — same shape as the top card (`lecture` is
    // already populated on every card now, so no extra fetch needed).
    const resumeNext = cards[0] ?? null;

    logger.info("listMyLearningProgress success", { traceId, customerId: userId, cardCount: cards.length, hasResume: !!resumeNext });
    return res.status(200).json({
      success: true,
      data: { cards, resumeNext },
    });
  } catch (e: any) {
    logger.error("listMyLearningProgress failed", { traceId, customerId: userId, error: getErrorMessage(e), stack: e.stack });
    return res.status(500).json({ success: false, message: e.message });
  }
};
