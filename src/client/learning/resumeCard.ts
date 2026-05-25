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

export async function buildResumeNextCard(input: Input): Promise<any | null> {
  const cid = new mongoose.Types.ObjectId(input.userId);
  const now = new Date();

  if (input.lectureType === "recorded") {
    const video = await Video.findById(input.videoId)
      .select("videoCategoryId")
      .lean();
    if (!video) return null;
    const cat = await VideoCategory.findById(video.videoCategoryId)
      .select("courseId")
      .lean();
    const courseId = cat?.courseId as Types.ObjectId | undefined;
    if (!courseId) return null;

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
