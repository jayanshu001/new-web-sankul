import { Request, Response } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { Course } from "../../models/course/Course.model";
import { PackageCourseSubscription } from "../../models/customer/PackageCourseSubscription.model";

const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, "Invalid id");

const progressSchema = z.object({
  positionSec: z.number().int().min(0).max(60 * 60 * 24), // sanity cap: 24h
  durationSec: z.number().int().min(0).max(60 * 60 * 24),
});

// A lecture is treated as completed once the user has watched ~95% of it.
// (Trailing credits / a missed last second shouldn't block the bar from filling.)
const COMPLETION_THRESHOLD = 0.95;

// POST /api/v1/client/courses/lectures/:videoId/progress
// Heartbeat from the mobile player. The first call for a (customer, video)
// pair upserts a new row — that's also what makes the course appear on the
// My Courses screen for the first time. No separate "start course" call.
export const reportLectureProgress = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

    const videoId = objectId.parse(req.params.videoId);
    const { positionSec, durationSec } = progressSchema.parse(req.body);

    // Resolve the video's course via VideoCategory, so we can store courseId
    // on the progress row (denormalised for fast per-course rollups later).
    const video = await Video.findById(videoId).select("videoCategoryId status").lean();
    if (!video || !video.status) {
      return res.status(404).json({ success: false, message: "Lecture not found." });
    }
    const category = await VideoCategory.findById(video.videoCategoryId)
      .select("courseId")
      .lean();
    if (!category?.courseId) {
      return res.status(400).json({
        success: false,
        message: "This lecture is not attached to a course.",
      });
    }

    // Don't grant a "watch" event on a course the user doesn't have access to.
    // We piggyback on the same gate the lecture endpoint uses: an active,
    // verified, non-expired subscription. Same predicate as lecture.controller
    // so behaviour can't drift.
    const now = new Date();
    const sub = await PackageCourseSubscription.findOne({
      customerId: new mongoose.Types.ObjectId(userId),
      courseId: category.courseId,
      status: true,
      paymentStatus: "verified",
      endAt: { $gt: now },
    }).select("_id");
    if (!sub) {
      return res.status(403).json({
        success: false,
        message: "No active subscription for this course.",
      });
    }

    const completedNow =
      durationSec > 0 && positionSec / durationSec >= COMPLETION_THRESHOLD;

    // We never *un*complete a lecture — once completed: true, it stays true even
    // if a later heartbeat reports an earlier position (user re-watched the start).
    const update: any = {
      $set: {
        courseId: category.courseId,
        positionSec,
        durationSec,
        lastWatchedAt: now,
      },
      $setOnInsert: {
        customerId: new mongoose.Types.ObjectId(userId),
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

    return res.status(200).json({ success: true, data: row });
  } catch (e: any) {
    if (e.issues) return res.status(400).json({ success: false, errors: e.issues });
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
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, message: "Unauthorized." });

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
        const daysLeft = sub?.endAt
          ? Math.max(0, Math.ceil((sub.endAt.getTime() - now.getTime()) / 86_400_000))
          : null;
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

    return res.status(200).json({
      success: true,
      data: { courses: courseCards, resumeNext },
    });
  } catch (e: any) {
    return res.status(500).json({ success: false, message: e.message });
  }
};
