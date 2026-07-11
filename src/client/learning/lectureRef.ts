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
  // Owning live course when this recorded lecture lives under a live-course
  // folder (VideoCategory.liveCourseId). null for catalog-course videos. The FE
  // opens the live player (getLiveLectureAPI) when this is set, skipping the
  // category rail that 403s for live recordings.
  liveCourseId: string | null;
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
