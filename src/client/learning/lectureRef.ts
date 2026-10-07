// Lecture notes: lecture reference builder for the notes lists.
// The "lecture" reference the notes / audio-notes lists return, so the FE can render
// the header card and open the right player at the right position in one round-trip.
// Scoped to the exact lecture the notes were taken on, unlike `buildResumeNextCard`
// (the course's last-watched lecture). `resume` comes from the customer's
// LectureProgress row; zero when never played.

type Input =
  | { lectureType: "recorded"; userId: string; videoId: string }
  | { lectureType: "live"; userId: string; liveSessionId: string };

export interface LectureRef {
  kind: "recorded" | "live";
  videoId: string | null;
  liveSessionId: string | null;
  title: string | null;
  topic: string | null;
  // Recorded lectures only.
  lessonTitle: string | null;
  videoCategoryId: string | null;
  courseId: string | null;
  // Set when the lecture lives under a live-course folder; the FE then opens the live
  // player instead of the category rail, which 403s for live recordings.
  liveCourseId: string | null;
  resume: {
    positionSec: number;
    durationSec: number;
    completed: boolean;
    lastWatchedAt: Date | null;
  };
}

export async function buildLectureRef(input: Input): Promise<LectureRef | null> {
  const lpSql = await import("../../modules/client-lecture-progress/client-lecture-progress.service");
  const cidNum = lpSql.parseLpId(String(input.userId));
  if (cidNum == null) return null;
  if (input.lectureType === "recorded") {
    const vid = lpSql.parseLpId(String(input.videoId));
    if (vid == null) return null;
    return lpSql.buildLectureRefSql({ lectureType: "recorded", customerId: cidNum, videoId: vid }) as Promise<LectureRef | null>;
  }
  const lsid = lpSql.parseLpId(String(input.liveSessionId));
  if (lsid == null) return null;
  return lpSql.buildLectureRefSql({ lectureType: "live", customerId: cidNum, liveSessionId: lsid }) as Promise<LectureRef | null>;
}
