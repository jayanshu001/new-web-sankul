// Shared "Resume Now" card builder. Produces the same shape as the
// /learning/progress/my hero card, but scoped to the parent course / live
// course of a specific lecture the user is currently viewing — so the
// lecture-notes and lecture-audio-notes endpoints can return a resumeNext
// alongside their notes list without duplicating the dashboard logic.

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
