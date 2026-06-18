import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

/**
 * Lecture-progress heartbeat + rollup reads on SQL (Wave 7 — net-new
 * ws_lecture_progress). Per-container model: ONE row per (customer, video) and one
 * per (customer, liveSession); container pointers (course/package/liveCourse) are
 * stamped additively and never cleared; `completed` is sticky. All ids are SQL ints
 * at runtime (customer-auth + catalog-*). See [[project_lecture_progress_per_container]].
 *
 * ⚠ FLAG-OFF (code-complete, not enabled): this is a 14-file content-join hub —
 * the heartbeat upsert here is clean + verifiable, but the resume/learning READS
 * (resumeCard.ts, learning/progress.controller.ts, course/dashboard rollups) span
 * many files and join Video/Course/Package/LiveSession content. The heartbeat
 * write + the profile-dashboard "completed" count are migrated here; the full read
 * surface flips once those consumer files are branched. Enabling reads-only while
 * heartbeats still write Mongo (or vice-versa) would split the data, so flag stays
 * OFF until the heartbeat + reads flip together.
 */
export const LECTURE_PROGRESS_MODULE = "client-lecture-progress";
export const isLectureProgressMysql = (): boolean => isMysqlModule(LECTURE_PROGRESS_MODULE);

export const parseLpId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const COMPLETION_THRESHOLD = 0.95;
const isComplete = (pos: number, dur: number) => dur > 0 && pos / dur >= COMPLETION_THRESHOLD;

/**
 * Heartbeat upsert keyed by (customer, video). Stamps the current container
 * pointer additively; never un-completes. Mirrors the Mongo findOneAndUpdate.
 */
export const upsertVideoProgress = async (input: {
  customerId: number; videoId: number;
  courseId?: number | null; packageId?: number | null; liveCourseId?: number | null;
  source?: string | null; positionSec: number; durationSec: number;
}): Promise<any> => {
  const now = new Date();
  const completedNow = isComplete(input.positionSec, input.durationSec);
  const existing = await prisma.lectureProgress.findFirst({ where: { customerId: input.customerId, videoId: input.videoId } });
  const set: any = { positionSec: input.positionSec, durationSec: input.durationSec, lastWatchedAt: now, updatedAt: now };
  if (input.courseId) set.courseId = input.courseId;
  if (input.packageId) set.packageId = input.packageId;
  if (input.liveCourseId) set.liveCourseId = input.liveCourseId;
  if (input.source) set.source = input.source;
  if (completedNow) { set.completed = true; set.completedAt = now; }
  if (existing) return prisma.lectureProgress.update({ where: { id: existing.id }, data: set });
  return prisma.lectureProgress.create({ data: { customerId: input.customerId, videoId: input.videoId, ...set, createdAt: now, completed: !!completedNow } });
};

/** Heartbeat upsert keyed by (customer, liveSession). */
export const upsertLiveSessionProgress = async (input: {
  customerId: number; liveSessionId: number; liveCourseId?: number | null;
  positionSec: number; durationSec: number;
}): Promise<any> => {
  const now = new Date();
  const completedNow = isComplete(input.positionSec, input.durationSec);
  const existing = await prisma.lectureProgress.findFirst({ where: { customerId: input.customerId, liveSessionId: input.liveSessionId } });
  const set: any = { positionSec: input.positionSec, durationSec: input.durationSec, lastWatchedAt: now, updatedAt: now };
  if (input.liveCourseId) set.liveCourseId = input.liveCourseId;
  if (completedNow) { set.completed = true; set.completedAt = now; }
  if (existing) return prisma.lectureProgress.update({ where: { id: existing.id }, data: set });
  return prisma.lectureProgress.create({ data: { customerId: input.customerId, liveSessionId: input.liveSessionId, ...set, createdAt: now, completed: !!completedNow } });
};

/** Per-container rollups for the "Resume Learning" feed (course/package/liveCourse). */
export const rollupByContainer = async (customerId: number, field: "courseId" | "packageId" | "liveCourseId") => {
  const rows = await prisma.lectureProgress.findMany({
    where: { customerId, [field]: { not: null } },
    orderBy: { lastWatchedAt: "desc" },
  });
  const byContainer = new Map<number, any>();
  for (const r of rows) {
    const k = (r as any)[field] as number;
    if (!byContainer.has(k)) byContainer.set(k, { _id: k, lastWatchedAt: r.lastWatchedAt, lastVideoId: r.videoId, lastLiveSessionId: r.liveSessionId, lastCourseId: r.courseId, lastPositionSec: r.positionSec, lastDurationSec: r.durationSec, completedCount: 0 });
    if (r.completed) byContainer.get(k)!.completedCount++;
  }
  return [...byContainer.values()];
};

/** Count of completed lectures in a container (resume-dashboard per-card stat). */
export const completedCountInContainer = (customerId: number, field: "courseId" | "packageId" | "liveCourseId", id: number) =>
  prisma.lectureProgress.count({ where: { customerId, [field]: id, completed: true } });

/** Profile-dashboard: total distinct lectures the customer has completed. */
export const completedLectureCount = (customerId: number): Promise<number> =>
  prisma.lectureProgress.count({ where: { customerId, completed: true } });
