// Lecture notes: resume card builder for the notes lists.
// "Resume Now" card in the /learning/progress/my hero shape, scoped to the parent
// course / live course of one lecture, for the lecture-notes endpoints' resumeNext.

type Input =
  | { lectureType: "recorded"; userId: string; videoId: string }
  | { lectureType: "live"; userId: string; liveSessionId: string };

export async function buildResumeNextCard(input: Input): Promise<any | null> {
  const lpSql = await import("../../modules/client-lecture-progress/client-lecture-progress.service");
  const cidNum = lpSql.parseLpId(String(input.userId));
  if (cidNum == null) return null;
  if (input.lectureType === "recorded") {
    const vid = lpSql.parseLpId(String(input.videoId));
    if (vid == null) return null;
    return lpSql.buildResumeNextCardSql({ lectureType: "recorded", customerId: cidNum, videoId: vid });
  }
  const lsid = lpSql.parseLpId(String(input.liveSessionId));
  if (lsid == null) return null;
  return lpSql.buildResumeNextCardSql({ lectureType: "live", customerId: cidNum, liveSessionId: lsid });
}
