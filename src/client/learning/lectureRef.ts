import mongoose, { Types } from "mongoose";
import { LectureProgress } from "../../models/customer/LectureProgress.model";
import { Video } from "../../models/course/Video.model";
import { VideoCategory } from "../../models/course/VideoCategory.model";
import { LiveSession } from "../../models/course/LiveSession.model";
import { resolveVideoCourseId } from "../course/resolveVideoCourse";
import { collapseProgressRows } from "./collapseProgress";

// Builds the "lecture" reference object the notes / audio-notes lists return
// so the FE can render the lecture header card (title, lesson, video time) and
// wire the "Go to Video" button straight to the right player at the right
// position — without a second round-trip.
//
// This is intentionally scoped to the EXACT lecture in the query (the videoId /
// liveSessionId the notes were taken on), unlike `buildResumeNextCard`, which
// returns the parent course's last-watched lecture (dashboard "resume now"
// semantics). The two are complementary: `lecture` = "this note's video",
// `resumeNext` = "where to pick the course back up".
//
// `resume` mirrors LectureProgress: video duration and last position are stored
// per (customer, lecture), so "Video time: 15:20" and the seek-on-open position
// both come from there. Null/zero when the customer has never played it.

type Input =
  | { lectureType: "recorded"; userId: string; videoId: string }
  | { lectureType: "live"; userId: string; liveSessionId: string };

export interface LectureRef {
  kind: "recorded" | "live";
  videoId: string | null;
  liveSessionId: string | null;
  title: string | null;
  topic: string | null;
  // The lesson / chapter the lecture sits under (recorded only).
  lessonTitle: string | null;
  videoCategoryId: string | null;
  courseId: string | null;
  resume: {
    // Last watched position + the duration the player has observed, both from
    // the customer's LectureProgress row for this lecture.
    positionSec: number;
    durationSec: number;
    completed: boolean;
    lastWatchedAt: Date | null;
  };
}

export async function buildLectureRef(input: Input): Promise<LectureRef | null> {
  const cid = new mongoose.Types.ObjectId(input.userId);

  if (input.lectureType === "recorded") {
    const video = await Video.findById(input.videoId)
      .select("title topic videoCategoryId")
      .lean<any>();
    if (!video) return null;

    const [chapter, courseId, progress] = await Promise.all([
      video.videoCategoryId
        ? VideoCategory.findById(video.videoCategoryId).select("title").lean<any>()
        : Promise.resolve(null),
      resolveVideoCourseId(video.videoCategoryId),
      // The note's video may have a progress row per container it was watched
      // from; this header just shows "where I am in this video", so collapse to
      // the furthest progress across containers.
      LectureProgress.find({ customerId: cid, videoId: new Types.ObjectId(input.videoId) })
        .select("positionSec durationSec completed completedAt lastWatchedAt")
        .lean<any>()
        .then((rows) => collapseProgressRows(rows)),
    ]);

    return {
      kind: "recorded",
      videoId: String(video._id),
      liveSessionId: null,
      title: video.title ?? null,
      topic: video.topic ?? null,
      lessonTitle: chapter?.title ?? null,
      videoCategoryId: video.videoCategoryId ? String(video.videoCategoryId) : null,
      courseId: courseId ? String(courseId) : null,
      resume: {
        positionSec: progress?.positionSec ?? 0,
        durationSec: progress?.durationSec ?? 0,
        completed: !!progress?.completed,
        lastWatchedAt: progress?.lastWatchedAt ?? null,
      },
    };
  }

  // live
  const session = await LiveSession.findById(input.liveSessionId)
    .select("title subject liveCourseIds")
    .lean<any>();
  if (!session) return null;

  const sessionRows = await LectureProgress.find({
    customerId: cid,
    liveSessionId: new Types.ObjectId(input.liveSessionId),
  })
    .select("positionSec durationSec completed completedAt lastWatchedAt")
    .lean<any>();
  const progress = collapseProgressRows(sessionRows);

  return {
    kind: "live",
    videoId: null,
    liveSessionId: String(session._id),
    title: session.title ?? null,
    topic: session.subject ?? null,
    lessonTitle: null,
    videoCategoryId: null,
    courseId: null,
    resume: {
      positionSec: progress?.positionSec ?? 0,
      durationSec: progress?.durationSec ?? 0,
      completed: !!progress?.completed,
      lastWatchedAt: progress?.lastWatchedAt ?? null,
    },
  };
}
