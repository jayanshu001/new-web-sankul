import mongoose, { Types } from "mongoose";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { LiveCourse } from "../../models/course/LiveCourse.model";
import { LiveCourseSubscription } from "../../models/customer/LiveCourseSubscription.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";
import { Course } from "../../models/course/Course.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { CourseEducator } from "../../models/course/CourseEducator.model";
import { Package } from "../../models/course/Package.model";
import { resolveVideoCourseId } from "../course/resolveVideoCourse";
import {
  resolveSubscribedPackageForVideo,
  resolveScopedReachableVideoCategoryIds,
} from "../course/scopeReachableCategories";

// Shared "Resume Now" card builder. Produces the same shape as the
// /learning/progress/my hero card, but scoped to the parent course / live
// course of a specific lecture the user is currently viewing — so the
// lecture-notes and lecture-audio-notes endpoints can return a resumeNext
// alongside their notes list without duplicating the dashboard logic.

type Input =
  | { lectureType: "recorded"; userId: string; videoId: string }
  | { lectureType: "live"; userId: string; liveSessionId: string };

const educatorOf = (e: any) =>
  e && e._id
    ? { id: String(e._id), name: e.name ?? null, image: e.image ?? null }
    : null;

const daysLeftOf = (endAt?: Date | null, now: Date = new Date()) =>
  endAt
    ? Math.max(0, Math.ceil((new Date(endAt).getTime() - now.getTime()) / 86_400_000))
    : null;

const percentOf = (done: number, total: number) =>
  total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

/**
 * Package-scoped "Resume Now" card for a recorded video that belongs to no
 * single Course but lives inside a package the customer is subscribed to.
 * Mirrors the course card's shape (type:"package") so the FE renders it the
 * same way; progress is rolled up by `packageId` and the total-lectures bar is
 * the count of active videos under the package's reachable category tree
 * (same downward childCategoryIds reachability the catalog/progress use).
 */
async function buildPackageResumeCard(
  cid: Types.ObjectId,
  fallbackVideoId: string,
  pkg: { packageId: Types.ObjectId; endAt: Date | null },
  now: Date
): Promise<any | null> {
  const packageId = pkg.packageId;

  const [pkgDoc, rollup, reachableCats] = await Promise.all([
    Package.findOne({ _id: packageId, active: true })
      .select("_id name image educatorId")
      .populate({ path: "educatorId", model: CourseEducator, select: "name image" })
      .lean<any>(),
    LectureProgress.aggregate([
      { $match: { customerId: cid, packageId } },
      { $sort: { lastWatchedAt: -1 } },
      {
        $group: {
          _id: "$packageId",
          lastWatchedAt: { $first: "$lastWatchedAt" },
          lastVideoId: { $first: "$videoId" },
          lastPositionSec: { $first: "$positionSec" },
          lastDurationSec: { $first: "$durationSec" },
          completedCount: { $sum: { $cond: ["$completed", 1, 0] } },
        },
      },
    ]),
    // Reachable category ids for this package — total = active videos filed on
    // any of them. Same set the catalog/progress reachability uses.
    resolveScopedReachableVideoCategoryIds("package", packageId),
  ]);

  if (!pkgDoc) return null;

  const catIds = Array.from(reachableCats).map((id) => new Types.ObjectId(id));
  const totalLectures = catIds.length
    ? await Video.countDocuments({ videoCategoryId: { $in: catIds }, status: true })
    : 0;

  const r = rollup[0];
  const lastVideoId = r?.lastVideoId ?? new Types.ObjectId(fallbackVideoId);

  const v = await Video.findById(lastVideoId)
    .select("title topic videoCategoryId")
    .lean<any>();
  const chapter = v?.videoCategoryId
    ? await VideoCategory.findById(v.videoCategoryId).select("title").lean<any>()
    : null;

  return {
    type: "package",
    id: String(pkgDoc._id),
    courseId: null,
    liveCourseId: null,
    packageId: String(pkgDoc._id),
    title: pkgDoc.name,
    subtitle: pkgDoc.educatorId?.name ? `By ${pkgDoc.educatorId.name}` : null,
    educator: educatorOf(pkgDoc.educatorId),
    thumbnail: pkgDoc.image ?? null,
    daysLeft: daysLeftOf(pkg.endAt, now),
    subscriptionEndAt: pkg.endAt ?? null,
    percentCompleted: percentOf(r?.completedCount ?? 0, totalLectures),
    completedLectures: r?.completedCount ?? 0,
    totalLectures,
    lastWatchedAt: r?.lastWatchedAt ?? null,
    lecture: v
      ? {
          _id: String(v._id),
          title: v.title,
          topic: v.topic ?? null,
          videoCategoryId: v.videoCategoryId ? String(v.videoCategoryId) : null,
          chapterTitle: chapter?.title ?? null,
        }
      : null,
    resume: {
      videoId: String(lastVideoId),
      liveSessionId: null,
      positionSec: r?.lastPositionSec ?? 0,
      durationSec: r?.lastDurationSec ?? 0,
    },
  };
}

export async function buildResumeNextCard(input: Input): Promise<any | null> {
  const cid = new mongoose.Types.ObjectId(input.userId);
  const now = new Date();

  if (input.lectureType === "recorded") {
    const video = await Video.findById(input.videoId)
      .select("videoCategoryId")
      .lean();
    if (!video) return null;
    // Resolve the owning course robustly. A video frequently lives under a
    // child category whose own courseId is null while the real link sits on an
    // ancestor or on Course.videoCategoryId. Reading only the leaf (the old
    // behaviour) wrongly returned null here, so notes/audio-notes responses got
    // `resumeNext: null` even when the lecture clearly belongs to a course.
    // Mirrors buildLectureRef, which already uses this resolver.
    const courseId = (await resolveVideoCourseId(video.videoCategoryId)) ?? undefined;
    // No owning Course? The video may still live inside a package the customer is
    // subscribed to (package-only content). Build a package-scoped resume card
    // instead of giving up — otherwise notes/audio-notes on package lectures
    // always returned `resumeNext: null`. (Course resolution takes priority: a
    // video reachable from both a course and a package keeps its course card.)
    if (!courseId) {
      const pkg = await resolveSubscribedPackageForVideo(
        cid,
        video.videoCategoryId as Types.ObjectId | null,
        new Types.ObjectId(input.videoId),
        now
      );
      if (!pkg) return null;
      return buildPackageResumeCard(cid, input.videoId, pkg, now);
    }

    const [course, sub, rollup, total] = await Promise.all([
      Course.findOne({ _id: courseId, status: true })
        .select("_id name image courseEducatorId")
        .populate({
          path: "courseEducatorId",
          model: CourseEducator,
          select: "name image",
        })
        .lean<any>(),
      PackageCourseSubscription.findOne({
        customerId: cid,
        courseId,
        status: true,
        paymentStatus: "verified",
        endAt: { $gt: now },
      })
        .select("endAt")
        .lean<any>(),
      LectureProgress.aggregate([
        { $match: { customerId: cid, courseId } },
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
      ]),
      VideoCategory.aggregate([
        { $match: { courseId, status: true } },
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

    if (!course) return null;

    const r = rollup[0];
    const totalLectures = total[0]?.total ?? 0;
    const lastVideoId = r?.lastVideoId ?? new Types.ObjectId(input.videoId);

    const v = await Video.findById(lastVideoId)
      .select("title topic videoCategoryId")
      .lean<any>();
    const chapter = v?.videoCategoryId
      ? await VideoCategory.findById(v.videoCategoryId).select("title").lean<any>()
      : null;

    return {
      type: "course",
      id: String(course._id),
      courseId: String(course._id),
      liveCourseId: null,
      packageId: null,
      title: course.name,
      subtitle: course.courseEducatorId?.name
        ? `By ${course.courseEducatorId.name}`
        : null,
      educator: educatorOf(course.courseEducatorId),
      thumbnail: course.image ?? null,
      daysLeft: daysLeftOf(sub?.endAt, now),
      subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(r?.completedCount ?? 0, totalLectures),
      completedLectures: r?.completedCount ?? 0,
      totalLectures,
      lastWatchedAt: r?.lastWatchedAt ?? null,
      lecture: v
        ? {
            _id: String(v._id),
            title: v.title,
            topic: v.topic ?? null,
            videoCategoryId: v.videoCategoryId ? String(v.videoCategoryId) : null,
            chapterTitle: chapter?.title ?? null,
          }
        : null,
      resume: {
        videoId: String(lastVideoId),
        liveSessionId: null,
        positionSec: r?.lastPositionSec ?? 0,
        durationSec: r?.lastDurationSec ?? 0,
      },
    };
  }

  // live
  const session = await LiveSession.findById(input.liveSessionId)
    .select("liveCourseIds")
    .lean<any>();
  const liveCourseIds = (session?.liveCourseIds ?? []) as Types.ObjectId[];
  if (liveCourseIds.length === 0) return null;

  // Pick the live course the user actually has an active subscription to
  // (matches dashboard semantics — a card represents an entitled container).
  const liveSub = await LiveCourseSubscription.findOne({
    customerId: cid,
    liveCourseId: { $in: liveCourseIds },
    status: true,
    paymentStatus: "verified",
    endAt: { $gt: now },
  })
    .select("liveCourseId endAt")
    .lean<any>();
  const liveCourseId = (liveSub?.liveCourseId ?? liveCourseIds[0]) as Types.ObjectId;

  const [liveCourse, rollup, totalRow] = await Promise.all([
    LiveCourse.findOne({ _id: liveCourseId, status: true })
      .select("_id name image courseEducatorId")
      .populate({
        path: "courseEducatorId",
        model: CourseEducator,
        select: "name image",
      })
      .lean<any>(),
    LectureProgress.aggregate([
      { $match: { customerId: cid, liveCourseId } },
      { $sort: { lastWatchedAt: -1 } },
      {
        $group: {
          _id: "$liveCourseId",
          lastWatchedAt: { $first: "$lastWatchedAt" },
          lastVideoId: { $first: "$videoId" },
          lastLiveSessionId: { $first: "$liveSessionId" },
          lastPositionSec: { $first: "$positionSec" },
          lastDurationSec: { $first: "$durationSec" },
          completedCount: { $sum: { $cond: ["$completed", 1, 0] } },
        },
      },
    ]),
    LiveSession.aggregate([
      { $match: { liveCourseIds: liveCourseId } },
      { $count: "total" },
    ]),
  ]);

  if (!liveCourse) return null;

  const r = rollup[0];
  const totalLectures = totalRow[0]?.total ?? 0;
  const lastLiveSessionId =
    r?.lastLiveSessionId ?? new Types.ObjectId(input.liveSessionId);

  const s = await LiveSession.findById(lastLiveSessionId)
    .select("title subject")
    .lean<any>();

  return {
    type: "live",
    id: String(liveCourse._id),
    liveCourseId: String(liveCourse._id),
    courseId: null,
    packageId: null,
    title: liveCourse.name,
    subtitle: liveCourse.courseEducatorId?.name
      ? `By ${liveCourse.courseEducatorId.name}`
      : null,
    educator: educatorOf(liveCourse.courseEducatorId),
    thumbnail: liveCourse.image ?? null,
    daysLeft: daysLeftOf(liveSub?.endAt, now),
    subscriptionEndAt: liveSub?.endAt ?? null,
    percentCompleted: percentOf(r?.completedCount ?? 0, totalLectures),
    completedLectures: r?.completedCount ?? 0,
    totalLectures,
    lastWatchedAt: r?.lastWatchedAt ?? null,
    lecture: s
      ? {
          _id: String(s._id),
          title: s.title,
          topic: s.subject ?? null,
          videoCategoryId: null,
          chapterTitle: null,
        }
      : null,
    resume: {
      videoId: r?.lastVideoId ? String(r.lastVideoId) : null,
      liveSessionId: String(lastLiveSessionId),
      positionSec: r?.lastPositionSec ?? 0,
      durationSec: r?.lastDurationSec ?? 0,
    },
  };
}
