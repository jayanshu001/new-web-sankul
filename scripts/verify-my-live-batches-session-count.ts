/**
 * Read-only check for the My Live Batches "X of Y sessions completed" counts
 * (GET /client/live-courses/my → progress).
 *
 *   npx tsx scripts/verify-my-live-batches-session-count.ts [customerId ...]
 *
 * With no ids it picks the customers holding the most live-course subscriptions.
 * For every card it recomputes the total straight from the tables and asserts:
 *   - totalSessions = distinct READY-with-recordings sessions + manual videos
 *   - no scheduled / live / processing stream is inside the total
 *   - completedSessions <= totalSessions, percentCompleted matches the two counts
 */
import "dotenv/config";
import assert from "node:assert/strict";
import { prisma } from "../src/config/prisma";
import { listMyLiveCoursesForClient } from "../src/modules/admin-live-course/admin-live-course.service";

const expectedTotal = async (liveCourseId: number): Promise<number> => {
  const folders = await prisma.videoCategory.findMany({ where: { liveCourseId, status: true }, select: { id: true } });
  if (!folders.length) return 0;
  const videos = await prisma.video.findMany({
    where: { status: true, videoCategoryId: { in: folders.map((f) => f.id) } },
    select: { id: true, liveSessionId: true, aws_id: true, youtube_id: true, vimeo_id: true },
  });
  const keys = new Set<string>();
  for (const v of videos) {
    if (!(v.aws_id || v.youtube_id || v.vimeo_id)) continue;
    if (v.liveSessionId == null) { keys.add(`v:${v.id}`); continue; }
    const s = await prisma.liveSession.findFirst({ where: { id: v.liveSessionId }, select: { status: true, recordings: true } });
    if (s?.status === "READY" && Array.isArray(s.recordings) && s.recordings.length > 0) keys.add(`s:${v.liveSessionId}`);
  }
  return keys.size;
};

(async () => {
  let ids = process.argv.slice(2).map(Number).filter(Number.isInteger);
  if (!ids.length) {
    const top = await prisma.liveCourseSubscription.groupBy({ by: ["customerId"], _count: true, orderBy: { _count: { customerId: "desc" } }, take: 10 });
    ids = top.map((t) => Number(t.customerId)).filter(Number.isInteger);
  }

  let cards = 0;
  for (const customerId of ids) {
    const r = await listMyLiveCoursesForClient(customerId, "all", undefined, { page: 1, limit: 100 });
    for (const c of r.liveCourses as any[]) {
      if (!c.liveCourse) continue;
      const { completedSessions, totalSessions, percentCompleted } = c.progress;
      const label = `customer ${customerId} liveCourse ${c.liveCourse._id}`;
      assert.deepEqual(Object.keys(c.progress).sort(), ["completedSessions", "percentCompleted", "totalSessions"], `${label}: progress keys changed`);
      assert.equal(totalSessions, await expectedTotal(Number(c.liveCourse._id)), `${label}: totalSessions`);
      assert.ok(completedSessions <= totalSessions, `${label}: completed ${completedSessions} > total ${totalSessions}`);
      assert.equal(percentCompleted, totalSessions > 0 ? Math.min(100, Math.round((completedSessions / totalSessions) * 100)) : 0, `${label}: percentCompleted`);
      console.log(`ok  ${label}: ${completedSessions} of ${totalSessions} (${percentCompleted}%)`);
      cards++;
    }
  }
  console.log(`\n${cards} card(s) verified across ${ids.length} customer(s).`);
  process.exit(0);
})().catch((err) => {
  console.error("FAILED:", err.message);
  process.exit(1);
});
