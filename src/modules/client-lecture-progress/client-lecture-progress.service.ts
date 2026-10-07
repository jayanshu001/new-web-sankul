// Lecture progress: heartbeat upserts, resume pointers and My Learning progress feeds.
import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import logger from "../../utils/logger";
import { getErrorMessage } from "../../utils/httpResponse";
import { buildPrismaSearch, matchesAllTokens } from "../../utils/searchFilter";

/**
 * ws_lecture_progress holds ONE row per (customer, video) and one per (customer, liveSession).
 * Container pointers (course/package/liveCourse) are stamped additively and never cleared;
 * `completed` is sticky. Per-enrollment "last watched" lives in ws_enrollment_resume.
 */

export const parseLpId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const COMPLETION_THRESHOLD = 0.95;
const isComplete = (pos: number, dur: number) => dur > 0 && pos / dur >= COMPLETION_THRESHOLD;

const sid = (n: number | null | undefined) => (n == null ? null : String(n));

/** The shape the player expects (`_id`, stringified ids); frozen. */
export const toProgressDto = (r: any) => ({
  _id: String(r.id),
  customerId: r.customerId,
  videoId: sid(r.videoId),
  liveSessionId: sid(r.liveSessionId),
  courseId: sid(r.courseId),
  liveCourseId: sid(r.liveCourseId),
  packageId: sid(r.packageId),
  source: r.source ?? null,
  positionSec: r.positionSec,
  durationSec: r.durationSec,
  completed: !!r.completed,
  completedAt: r.completedAt ?? null,
  lastWatchedAt: r.lastWatchedAt,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

/**
 * `prisma.upsert()` alone is NOT race-safe here: Prisma only emits a native
 * `INSERT ... ON DUPLICATE KEY UPDATE` when the model has a single unique constraint, and
 * ws_lecture_progress has two, so concurrent heartbeats both INSERT and one dies on P2002.
 * On P2002 the row provably exists, so updating by the same key is correct and terminal.
 */
const upsertRacingSafe = async (
  where: any,
  update: any,
  create: any
): Promise<any> => {
  try {
    return await prisma.lectureProgress.upsert({ where, update, create });
  } catch (e: any) {
    if (e?.code === "P2002") {
      return prisma.lectureProgress.update({ where, data: update });
    }
    throw e;
  }
};

/** Stamps the current container pointer additively; never un-completes. */
export const upsertVideoProgress = async (input: {
  customerId: number; videoId: number;
  courseId?: number | null; packageId?: number | null; liveCourseId?: number | null;
  source?: string | null; positionSec: number; durationSec: number;
}): Promise<any> => {
  const now = new Date();
  const completedNow = isComplete(input.positionSec, input.durationSec);
  const set: any = { positionSec: input.positionSec, durationSec: input.durationSec, lastWatchedAt: now, updatedAt: now };
  if (input.courseId) set.courseId = input.courseId;
  if (input.packageId) set.packageId = input.packageId;
  if (input.liveCourseId) set.liveCourseId = input.liveCourseId;
  if (input.source) set.source = input.source;
  if (completedNow) { set.completed = true; set.completedAt = now; }
  // Highest-frequency write on the platform (a student may have two players open); see upsertRacingSafe.
  return upsertRacingSafe(
    { uniq_customer_video: { customerId: input.customerId, videoId: input.videoId } },
    set,
    { customerId: input.customerId, videoId: input.videoId, ...set, createdAt: now, completed: !!completedNow }
  );
};

export const upsertLiveSessionProgress = async (input: {
  customerId: number; liveSessionId: number; liveCourseId?: number | null;
  positionSec: number; durationSec: number;
}): Promise<any> => {
  const now = new Date();
  const completedNow = isComplete(input.positionSec, input.durationSec);
  const set: any = { positionSec: input.positionSec, durationSec: input.durationSec, lastWatchedAt: now, updatedAt: now };
  if (input.liveCourseId) set.liveCourseId = input.liveCourseId;
  if (completedNow) { set.completed = true; set.completedAt = now; }
  return upsertRacingSafe(
    { uniq_customer_live_session: { customerId: input.customerId, liveSessionId: input.liveSessionId } },
    set,
    { customerId: input.customerId, liveSessionId: input.liveSessionId, ...set, createdAt: now, completed: !!completedNow }
  );
};

/**
 * LectureProgress is global per (customer, video), so a lecture shared by a course AND a
 * package holds one last_watched_at and their resume cards would mirror each other. This keeps
 * a separate pointer per (customer, scopeKind, scopeId). See docs/be-dashboard-resume-scope.md.
 */
export const upsertEnrollmentResume = async (input: {
  customerId: number;
  scopeKind: "course" | "package" | "liveCourse";
  scopeId: number;
  videoId?: number | null;
  liveSessionId?: number | null;
  now: Date;
}): Promise<void> => {
  await prisma.enrollmentResume.upsert({
    where: { uniq_customer_scope: { customerId: input.customerId, scopeKind: input.scopeKind, scopeId: input.scopeId } },
    create: {
      customerId: input.customerId, scopeKind: input.scopeKind, scopeId: input.scopeId,
      videoId: input.videoId ?? null, liveSessionId: input.liveSessionId ?? null,
      lastWatchedAt: input.now, createdAt: input.now, updatedAt: input.now,
    },
    update: {
      videoId: input.videoId ?? null, liveSessionId: input.liveSessionId ?? null,
      lastWatchedAt: input.now, updatedAt: input.now,
    },
  });
};

// Latest-watched pointer + completed count per container, newest first.
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

export const completedCountInContainer = (customerId: number, field: "courseId" | "packageId" | "liveCourseId", id: number) =>
  prisma.lectureProgress.count({ where: { customerId, [field]: id, completed: true } });

export const completedLectureCount = (customerId: number): Promise<number> =>
  prisma.lectureProgress.count({ where: { customerId, completed: true } });

const percentOf = (pos: number, dur: number) =>
  dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;

/** Free-video "Resume Learning" feed; no container/DAG/subscription joins. */
export const listFreeResume = async (
  customerId: number,
  opts: { search?: string | null; skip?: number; limit?: number } = {}
): Promise<{ cards: any[]; resumeNext: any | null; total: number }> => {
  const skip = opts.skip ?? 0;
  const limit = opts.limit ?? 20;

  const rows = await prisma.lectureProgress.findMany({
    where: { customerId, source: "free", videoId: { not: null } },
    orderBy: { lastWatchedAt: "desc" },
  });
  if (rows.length === 0) return { cards: [], resumeNext: null, total: 0 };

  const videoIds = rows.map((r) => r.videoId!).filter((v) => v != null);
  // Only videos still live AND free: a video flipped to paid/disabled would 403 at /courses/lecture.
  const videoWhere: any = { id: { in: videoIds }, status: true, priceType: "free" };
  const videoSearch = buildPrismaSearch(opts.search, ["title"]);
  if (videoSearch) videoWhere.AND = videoSearch.AND;
  const videos = await prisma.video.findMany({
    where: videoWhere,
    select: {
      id: true, title: true, topic: true, videoCategoryId: true,
      VideoCategory: { select: { id: true, title: true, image: true } },
    },
  });
  const byId = new Map(videos.map((v) => [v.id, v]));

  const allCards = rows
    .map((r) => {
      const v = byId.get(r.videoId!);
      if (!v) return null; // deleted / disabled / no longer free — skip
      const cat = v.VideoCategory;
      return {
        type: "free" as const,
        videoId: String(v.id),
        categoryId: cat ? String(cat.id) : null,
        title: v.title ?? null,
        topic: v.topic ?? null,
        chapterTitle: cat?.title ?? null,
        thumbnail: cat?.image ?? null,
        daysLeft: null, // free videos never expire
        completed: !!r.completed,
        percentCompleted: percentOf(r.positionSec, r.durationSec),
        lastWatchedAt: r.lastWatchedAt,
        resume: {
          videoId: String(v.id),
          positionSec: r.positionSec,
          durationSec: r.durationSec,
          remainingSec: Math.max(0, r.durationSec - r.positionSec),
        },
      };
    })
    .filter(Boolean);

  // The hero card is the most recent match regardless of page.
  const total = allCards.length;
  const cards = allCards.slice(skip, skip + limit);
  return { cards, resumeNext: allCards[0] ?? null, total };
};

/**
 * Container heartbeat (course/package/liveCourse). Reachability uses the category-tree DAG
 * resolver; entitlement is an active subscription (`status=true` is the verified gate).
 */
export const reportContainerProgress = async (input: {
  customerId: number;
  videoId: number;
  scope: { kind: "course" | "package" | "liveCourse"; id: number };
  positionSec: number;
  durationSec: number;
}): Promise<
  | { ok: true; row: any }
  | { ok: false; status: number; message: string }
> => {
  const { reachableCategoryIds } = await import("../catalog-category-tree/category-tree.service");
  const now = new Date();

  const video = await prisma.video.findFirst({
    where: { id: input.videoId, status: true },
    select: { id: true, videoCategoryId: true, priceType: true },
  });
  if (!video) return { ok: false, status: 404, message: "Lecture not found." };
  const isFree = video.priceType === "free";

  // Same question the catalog answers. Free videos are exempt (surfaced via the free catalog).
  const reachable = await reachableCategoryIds(input.scope.kind, input.scope.id);
  const leaf = video.videoCategoryId ?? null;
  const videoReachable = isFree || (leaf != null && reachable.has(leaf));

  const labels = { course: "course", package: "package", liveCourse: "live course" } as const;
  if (!videoReachable) {
    return { ok: false, status: 400, message: `Video is not part of the scoped ${labels[input.scope.kind]}.` };
  }

  // Entitlement gate per kind. Free videos only need the container to EXIST (no status
  // filter — a deactivated container's free items still report progress for consistency).
  if (input.scope.kind === "course") {
    if (isFree) {
      const c = await prisma.course.findFirst({ where: { id: input.scope.id }, select: { id: true } });
      if (!c) return { ok: false, status: 404, message: "Course not found." };
    } else {
      const sub = await prisma.packageCourseSubscription.findFirst({
        where: { customerId: input.customerId, courseId: input.scope.id, status: true, endAt: { gt: now } },
        select: { id: true },
      });
      if (!sub) return { ok: false, status: 403, message: "No active subscription for this lecture." };
    }
  } else if (input.scope.kind === "package") {
    if (isFree) {
      const p = await prisma.package.findFirst({ where: { id: input.scope.id }, select: { id: true } });
      if (!p) return { ok: false, status: 404, message: "Package not found." };
    } else {
      const sub = await prisma.packageCourseSubscription.findFirst({
        where: { customerId: input.customerId, packageId: input.scope.id, status: true, endAt: { gt: now } },
        select: { id: true },
      });
      if (!sub) return { ok: false, status: 403, message: "No active subscription for this lecture." };
    }
  } else {
    if (isFree) {
      const lc = await prisma.liveCourse.findFirst({ where: { id: input.scope.id }, select: { id: true } });
      if (!lc) return { ok: false, status: 404, message: "Live course not found." };
    } else {
      const sub = await prisma.liveCourseSubscription.findFirst({
        // A live-course subscription row exists only for a paid order, so `status` + window is the entitlement.
        where: { customerId: input.customerId, liveCourseId: input.scope.id, status: true, endAt: { gt: now } },
        select: { id: true },
      });
      if (!sub) return { ok: false, status: 403, message: "No active subscription for this lecture." };
    }
  }

  const row = await upsertVideoProgress({
    customerId: input.customerId,
    videoId: input.videoId,
    courseId: input.scope.kind === "course" ? input.scope.id : null,
    packageId: input.scope.kind === "package" ? input.scope.id : null,
    liveCourseId: input.scope.kind === "liveCourse" ? input.scope.id : null,
    positionSec: input.positionSec,
    durationSec: input.durationSec,
  });

  // Failure-isolated: a pointer write must never fail the heartbeat (`row` is already saved).
  try {
    await upsertEnrollmentResume({
      customerId: input.customerId, scopeKind: input.scope.kind, scopeId: input.scope.id,
      videoId: input.videoId, liveSessionId: null, now,
    });
  } catch (err) {
    logger.warn("reportContainerProgress: enrollment-resume upsert failed", {
      customerId: input.customerId, scope: input.scope, videoId: input.videoId, error: getErrorMessage(err),
    });
  }

  return { ok: true, row };
};

/**
 * Entitlement: an active LiveCourseSubscription for ANY live course the session is published
 * under. Stamps the first matching liveCourseId.
 */
export const reportLiveSessionProgress = async (input: {
  customerId: number;
  liveSessionId: number;
  positionSec: number;
  durationSec: number;
}): Promise<
  | { ok: true; row: any }
  | { ok: false; status: number; message: string }
> => {
  const now = new Date();
  const session = await prisma.liveSession.findFirst({ where: { id: input.liveSessionId }, select: { id: true } });
  if (!session) return { ok: false, status: 404, message: "Live session not found." };

  const links = await prisma.liveSessionCourse.findMany({ where: { liveSessionId: input.liveSessionId }, select: { liveCourseId: true } });
  const liveCourseIds = links.map((l) => l.liveCourseId);
  if (!liveCourseIds.length) return { ok: false, status: 404, message: "Live session not found." };

  const sub = await prisma.liveCourseSubscription.findFirst({
    where: { customerId: input.customerId, liveCourseId: { in: liveCourseIds }, status: true, endAt: { gt: now } },
    select: { liveCourseId: true },
  });
  if (!sub) return { ok: false, status: 403, message: "No active subscription for this live course." };

  const row = await upsertLiveSessionProgress({
    customerId: input.customerId,
    liveSessionId: input.liveSessionId,
    liveCourseId: sub.liveCourseId,
    positionSec: input.positionSec,
    durationSec: input.durationSec,
  });

  try {
    await upsertEnrollmentResume({
      customerId: input.customerId, scopeKind: "liveCourse", scopeId: sub.liveCourseId,
      videoId: null, liveSessionId: input.liveSessionId, now,
    });
  } catch (err) {
    logger.warn("reportLiveSessionProgress: enrollment-resume upsert failed", {
      customerId: input.customerId, liveCourseId: sub.liveCourseId, liveSessionId: input.liveSessionId, error: getErrorMessage(err),
    });
  }

  return { ok: true, row };
};

const daysLeftOf = computeDaysLeft;
const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
const educatorOf = (e: any) => (e ? { id: String(e.id), name: e.name ?? null, image: e.image ?? null } : null);

const videosUnderCategories = async (catIds: number[]): Promise<number> => {
  if (!catIds.length) return 0;
  return prisma.video.count({ where: { status: true, videoCategoryId: { in: catIds } } });
};

/**
 * The % bar denominator: course/package → videos under the reachable category tree;
 * liveCourse → sessions published under it.
 */
const containerTotals = async (courseIds: number[], packageIds: number[], liveIds: number[]) => {
  const { reachableCategoryIds } = await import("../catalog-category-tree/category-tree.service");
  const courseTotal = new Map<number, number>();
  const packageTotal = new Map<number, number>();
  const liveTotal = new Map<number, number>();

  for (const id of courseIds) {
    const cats = await reachableCategoryIds("course", id);
    courseTotal.set(id, await videosUnderCategories([...cats]));
  }
  for (const id of packageIds) {
    const cats = await reachableCategoryIds("package", id);
    packageTotal.set(id, await videosUnderCategories([...cats]));
  }
  for (const id of liveIds) {
    const n = await prisma.liveSessionCourse.count({ where: { liveCourseId: id } });
    liveTotal.set(id, n);
  }
  return { courseTotal, packageTotal, liveTotal };
};

const resolveLectures = async (videoIds: number[]) => {
  const ids = [...new Set(videoIds.filter((v) => v != null))];
  if (!ids.length) return new Map<number, any>();
  const vids = await prisma.video.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, topic: true, videoCategoryId: true, VideoCategory: { select: { id: true, title: true } } },
  });
  return new Map(vids.map((v) => [v.id, {
    _id: String(v.id), title: v.title, topic: v.topic ?? null,
    videoCategoryId: v.videoCategoryId ? String(v.videoCategoryId) : null,
    chapterTitle: v.VideoCategory?.title ?? null,
  }]));
};

const resolveSessions = async (sessionIds: number[]) => {
  const ids = [...new Set(sessionIds.filter((v) => v != null))];
  if (!ids.length) return new Map<number, any>();
  const rows = await prisma.liveSession.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, subject: true } });
  return new Map(rows.map((s) => [s.id, { _id: String(s.id), title: s.title, topic: s.subject ?? null, videoCategoryId: null, chapterTitle: null }]));
};

type ResumePtr = { scopeId: number; videoId: number | null; liveSessionId: number | null; lastWatchedAt: Date | null };

const resumePointers = async (customerId: number, kind: "course" | "package" | "liveCourse"): Promise<ResumePtr[]> => {
  const rows = await prisma.enrollmentResume.findMany({
    where: { customerId, scopeKind: kind },
    orderBy: { lastWatchedAt: "desc" },
    select: { scopeId: true, videoId: true, liveSessionId: true, lastWatchedAt: true },
  });
  return rows.map((r) => ({ scopeId: r.scopeId, videoId: r.videoId, liveSessionId: r.liveSessionId, lastWatchedAt: r.lastWatchedAt }));
};

type Pos = { positionSec: number; durationSec: number };

const videoPositions = async (customerId: number, videoIds: number[]): Promise<Map<number, Pos>> => {
  const ids = [...new Set(videoIds)];
  if (!ids.length) return new Map();
  const rows = await prisma.lectureProgress.findMany({ where: { customerId, videoId: { in: ids } }, select: { videoId: true, positionSec: true, durationSec: true } });
  return new Map(rows.map((r) => [r.videoId!, { positionSec: r.positionSec, durationSec: r.durationSec }]));
};

const sessionPositions = async (customerId: number, sessionIds: number[]): Promise<Map<number, Pos>> => {
  const ids = [...new Set(sessionIds)];
  if (!ids.length) return new Map();
  const rows = await prisma.lectureProgress.findMany({ where: { customerId, liveSessionId: { in: ids } }, select: { liveSessionId: true, positionSec: true, durationSec: true } });
  return new Map(rows.map((r) => [r.liveSessionId!, { positionSec: r.positionSec, durationSec: r.durationSec }]));
};

const completedCounts = async (customerId: number, field: "courseId" | "packageId" | "liveCourseId", ids: number[]): Promise<Map<number, number>> => {
  if (!ids.length) return new Map();
  const grp = await prisma.lectureProgress.groupBy({ by: [field], where: { customerId, completed: true, [field]: { in: ids } }, _count: { _all: true } });
  return new Map(grp.map((g: any) => [g[field] as number, g._count._all as number]));
};

/**
 * Unified "Resume Learning" feed.
 *
 * `percentCompleted` is VIDEO-centric (progress through the last-watched lecture), not
 * container-wide; `completedLectures`/`totalLectures` are the container-wide counts.
 *
 * PURCHASED-ONLY: a card is emitted only with an ACTIVE subscription. Preview/free watches
 * inside a paid container stamp a pointer but must not surface a card; free standalone
 * videos use `listFreeResume`. See docs/client/DASHBOARD_RESUME_PROGRESS.md.
 */
export const listMyLearningProgress = async (
  customerId: number,
  opts: { search?: string; skip?: number; limit?: number } = {}
): Promise<{ cards: any[]; resumeNext: any; total: number }> => {
  const now = new Date();
  // Pointers come from ws_enrollment_resume, NOT LectureProgress (global per video, which
  // would leak one product's last video onto another's card for a shared lecture).
  // Live courses are deliberately excluded (FE request): a live session is not resumable.
  // The live pointer set is left EMPTY so every `liveIds.length`-guarded branch below
  // short-circuits; to re-enable, restore a third `resumePointers` call.
  const [coursePtrs, packagePtrs] = await Promise.all([
    resumePointers(customerId, "course"),
    resumePointers(customerId, "package"),
  ]);
  const livePtrs: ResumePtr[] = [];

  const courseIds = coursePtrs.map((r) => r.scopeId);
  const packageIds = packagePtrs.map((r) => r.scopeId);
  const liveIds = livePtrs.map((r) => r.scopeId);

  const ptrVideoIds = [...coursePtrs, ...packagePtrs, ...livePtrs].map((p) => p.videoId).filter((v): v is number => v != null);
  const ptrSessionIds = livePtrs.map((p) => p.liveSessionId).filter((v): v is number => v != null);

  const [courses, packages, liveCourses, courseSubs, packageSubs, liveSubs, totals,
         courseDone, packageDone, liveDone, videoPos, sessionPos] = await Promise.all([
    // No status filter: a deactivated-but-owned container still shows; deleted rows drop out.
    courseIds.length ? prisma.course.findMany({ where: { id: { in: courseIds } }, select: { id: true, name: true, image: true, educator: { select: { id: true, name: true, image: true } } } }) : [],
    packageIds.length ? prisma.package.findMany({ where: { id: { in: packageIds } }, select: { id: true, name: true, image: true, educator_id: true } }) : [],
    liveIds.length ? prisma.liveCourse.findMany({ where: { id: { in: liveIds } }, select: { id: true, name: true, image: true, educatorId: true } }) : [],
    courseIds.length ? prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { in: courseIds }, status: true, endAt: { gt: now } }, select: { courseId: true, endAt: true } }) : [],
    packageIds.length ? prisma.packageCourseSubscription.findMany({ where: { customerId, packageId: { in: packageIds }, status: true, endAt: { gt: now } }, select: { packageId: true, endAt: true } }) : [],
    liveIds.length ? prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: liveIds }, status: true, endAt: { gt: now } }, select: { liveCourseId: true, endAt: true } }) : [],
    containerTotals(courseIds, packageIds, liveIds),
    completedCounts(customerId, "courseId", courseIds),
    completedCounts(customerId, "packageId", packageIds),
    completedCounts(customerId, "liveCourseId", liveIds),
    videoPositions(customerId, ptrVideoIds),
    sessionPositions(customerId, ptrSessionIds),
  ]);

  // `lastCourseId` is intentionally null: a package's pointer is package-scoped.
  const posOf = (videoId: number | null, liveSessionId: number | null): Pos => {
    if (videoId != null && videoPos.has(videoId)) return videoPos.get(videoId)!;
    if (liveSessionId != null && sessionPos.has(liveSessionId)) return sessionPos.get(liveSessionId)!;
    return { positionSec: 0, durationSec: 0 };
  };
  const perCourse = coursePtrs.map((p) => {
    const pos = posOf(p.videoId, null);
    return { _id: p.scopeId, lastWatchedAt: p.lastWatchedAt, lastVideoId: p.videoId, lastLiveSessionId: null, lastCourseId: null, lastPositionSec: pos.positionSec, lastDurationSec: pos.durationSec, completedCount: courseDone.get(p.scopeId) ?? 0 };
  });
  const perPackage = packagePtrs.map((p) => {
    const pos = posOf(p.videoId, null);
    return { _id: p.scopeId, lastWatchedAt: p.lastWatchedAt, lastVideoId: p.videoId, lastLiveSessionId: null, lastCourseId: null, lastPositionSec: pos.positionSec, lastDurationSec: pos.durationSec, completedCount: packageDone.get(p.scopeId) ?? 0 };
  });
  const perLive = livePtrs.map((p) => {
    const pos = posOf(p.videoId, p.liveSessionId);
    return { _id: p.scopeId, lastWatchedAt: p.lastWatchedAt, lastVideoId: p.videoId, lastLiveSessionId: p.liveSessionId, lastCourseId: null, lastPositionSec: pos.positionSec, lastDurationSec: pos.durationSec, completedCount: liveDone.get(p.scopeId) ?? 0 };
  });

  const eduIds = [...new Set([...packages.map((p) => p.educator_id), ...liveCourses.map((l) => l.educatorId)].filter((x) => x != null))] as number[];
  const educators = eduIds.length ? await prisma.courseEducator.findMany({ where: { id: { in: eduIds } }, select: { id: true, name: true, image: true } }) : [];
  const eduById = new Map(educators.map((e) => [e.id, e]));

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const packageById = new Map(packages.map((p) => [p.id, p]));
  const liveById = new Map(liveCourses.map((l) => [l.id, l]));
  const courseSubBy = new Map(courseSubs.map((s) => [s.courseId!, s]));
  const packageSubBy = new Map(packageSubs.map((s) => [s.packageId!, s]));
  const liveSubBy = new Map(liveSubs.map((s) => [s.liveCourseId, s]));

  const lectureMap = await resolveLectures([...perCourse, ...perPackage, ...perLive].map((p) => p.lastVideoId).filter((v): v is number => v != null));
  const sessionMap = await resolveSessions(perLive.map((p) => p.lastLiveSessionId).filter((v): v is number => v != null));

  const cards: any[] = [];
  for (const p of perCourse) {
    const c = courseById.get(p._id); if (!c) continue;
    const sub = courseSubBy.get(p._id);
    if (!sub) continue; // purchased-only
    const total = totals.courseTotal.get(p._id) ?? 0;
    cards.push({
      type: "course", id: String(c.id), courseId: String(c.id), liveCourseId: null, packageId: null,
      title: c.name, subtitle: c.educator?.name ? `By ${c.educator.name}` : null,
      educator: educatorOf(c.educator), thumbnail: c.image ?? null, isPurchased: true,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(p.lastPositionSec, p.lastDurationSec), completedLectures: p.completedCount, totalLectures: total,
      lastWatchedAt: p.lastWatchedAt, lecture: p.lastVideoId ? lectureMap.get(p.lastVideoId) ?? null : null,
      resume: { videoId: p.lastVideoId ? String(p.lastVideoId) : null, liveSessionId: null, positionSec: p.lastPositionSec, durationSec: p.lastDurationSec },
    });
  }
  for (const p of perPackage) {
    const pkg = packageById.get(p._id); if (!pkg) continue;
    const sub = packageSubBy.get(p._id);
    if (!sub) continue; // purchased-only
    const total = totals.packageTotal.get(p._id) ?? 0;
    cards.push({
      type: "package", id: String(pkg.id), packageId: String(pkg.id), courseId: p.lastCourseId ? String(p.lastCourseId) : null, liveCourseId: null,
      title: pkg.name, subtitle: pkg.educator_id && eduById.get(pkg.educator_id)?.name ? `By ${eduById.get(pkg.educator_id)!.name}` : null,
      educator: pkg.educator_id ? educatorOf(eduById.get(pkg.educator_id)) : null, thumbnail: pkg.image ?? null, isPurchased: true,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(p.lastPositionSec, p.lastDurationSec), completedLectures: p.completedCount, totalLectures: total,
      lastWatchedAt: p.lastWatchedAt, lecture: p.lastVideoId ? lectureMap.get(p.lastVideoId) ?? null : null,
      resume: { videoId: p.lastVideoId ? String(p.lastVideoId) : null, liveSessionId: null, positionSec: p.lastPositionSec, durationSec: p.lastDurationSec },
    });
  }
  for (const p of perLive as any[]) {
    const lc = liveById.get(p._id); if (!lc) continue;
    const sub = liveSubBy.get(p._id);
    if (!sub) continue; // purchased-only
    const total = totals.liveTotal.get(p._id) ?? 0;
    const edu = lc.educatorId ? eduById.get(lc.educatorId) : null;
    cards.push({
      type: "live", id: String(lc.id), liveCourseId: String(lc.id), courseId: null, packageId: null,
      title: lc.name, subtitle: edu?.name ? `By ${edu.name}` : null, educator: educatorOf(edu), thumbnail: lc.image ?? null, isPurchased: true,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(p.lastPositionSec, p.lastDurationSec), completedLectures: p.completedCount, totalLectures: total,
      lastWatchedAt: p.lastWatchedAt,
      lecture: (p.lastLiveSessionId ? sessionMap.get(p.lastLiveSessionId) : null) ?? (p.lastVideoId ? lectureMap.get(p.lastVideoId) : null) ?? null,
      resume: { videoId: p.lastVideoId ? String(p.lastVideoId) : null, liveSessionId: p.lastLiveSessionId ? String(p.lastLiveSessionId) : null, positionSec: p.lastPositionSec, durationSec: p.lastDurationSec },
    });
  }
  cards.sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());

  // resumeNext = the most recent matching card, independent of the page.
  const matched = opts.search
    ? cards.filter((c) => matchesAllTokens(opts.search, [c.title]))
    : cards;
  const total = matched.length;
  const skip = opts.skip ?? 0;
  const limit = opts.limit ?? matched.length;
  const paged = matched.slice(skip, skip + limit);
  return { cards: paged, resumeNext: matched[0] ?? null, total };
};

/** "My Courses" resume feed (course-only). */
export const listMyCoursesForResume = async (
  customerId: number,
  opts: { search?: string; skip?: number; limit?: number } = {}
): Promise<{ courses: any[]; resumeNext: any; total: number }> => {
  const now = new Date();
  const perCourse = (await rollupByContainer(customerId, "courseId"))
    .sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());
  if (!perCourse.length) return { courses: [], resumeNext: null, total: 0 };

  // No status filter: a deactivated-but-owned course stays; deleted rows drop out.
  const allCourseIds = perCourse.map((p) => p._id);
  const activeCourses = await prisma.course.findMany({
    where: { id: { in: allCourseIds } },
    select: { id: true, name: true, image: true },
  });
  const courseById = new Map(activeCourses.map((c) => [c.id, c]));

  let candidates = perCourse.filter((p) => courseById.has(p._id));
  if (opts.search) {
    candidates = candidates.filter((p) =>
      matchesAllTokens(opts.search, [courseById.get(p._id)?.name])
    );
  }
  const total = candidates.length;
  const skip = Math.max(opts.skip ?? 0, 0);
  const limit = Math.max(opts.limit ?? 20, 1);
  const pageCourses = candidates.slice(skip, skip + limit);

  const courseIds = pageCourses.map((p) => p._id);
  const [subs, totals] = await Promise.all([
    prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { in: courseIds }, status: true, endAt: { gt: now } }, select: { courseId: true, endAt: true } }),
    containerTotals(courseIds, [], []),
  ]);
  const subBy = new Map(subs.map((s) => [s.courseId!, s]));

  const courseCards = pageCourses.map((p) => {
    const c = courseById.get(p._id); if (!c) return null;
    const sub = subBy.get(p._id); const total = totals.courseTotal.get(p._id) ?? 0;
    return {
      course: { _id: String(c.id), name: c.name, thumbnail: c.image ?? null, image: c.image ?? null, author: null },
      daysLeft: daysLeftOf(sub?.endAt, now), percentCompleted: pct(p.completedCount, total),
      completedLectures: p.completedCount, totalLectures: total, lastWatchedAt: p.lastWatchedAt,
      lastVideoId: p.lastVideoId ? String(p.lastVideoId) : null,
    };
  }).filter(Boolean);

  const top = perCourse[0];
  let resumeNext: any = null;
  if (top?.lastVideoId) {
    const [lastVideo, lastCourse] = await Promise.all([
      prisma.video.findFirst({ where: { id: top.lastVideoId }, select: { id: true, title: true, topic: true } }),
      prisma.course.findFirst({ where: { id: top._id }, select: { id: true, name: true, image: true } }),
    ]);
    if (lastVideo && lastCourse) {
      const remainingSec = Math.max(0, top.lastDurationSec - top.lastPositionSec);
      const lecturePercent = pct(top.lastPositionSec, top.lastDurationSec);
      resumeNext = {
        course: { _id: String(lastCourse.id), name: lastCourse.name, thumbnail: lastCourse.image ?? null },
        lecture: { _id: String(lastVideo.id), title: lastVideo.title, topic: lastVideo.topic ?? null },
        lastWatchedAt: top.lastWatchedAt, positionSec: top.lastPositionSec, durationSec: top.lastDurationSec,
        remainingSec, percent: lecturePercent,
      };
    }
  }
  return { courses: courseCards, resumeNext, total };
};

/** Collapse multiple progress rows (same video, different containers) → furthest. */
const collapseRows = (rows: any[]): any | null => {
  if (!rows.length) return null;
  return rows.reduce((best, r) => {
    if (!best) return r;
    if (r.completed && !best.completed) return r;
    if (!!r.completed === !!best.completed && (r.positionSec ?? 0) > (best.positionSec ?? 0)) return r;
    return best;
  }, null as any);
};

/** The exact video/session a notes list belongs to. */
export const buildLectureRefSql = async (input:
  | { lectureType: "recorded"; customerId: number; videoId: number }
  | { lectureType: "live"; customerId: number; liveSessionId: number }
): Promise<any | null> => {
  if (input.lectureType === "recorded") {
    const video = await prisma.video.findFirst({
      where: { id: input.videoId },
      // Lectures under a live-course folder (VideoCategory.liveCourseId) must expose it so the
      // FE opens the live player instead of the catalog category rail (which 403s).
      select: { id: true, title: true, topic: true, videoCategoryId: true, VideoCategory: { select: { title: true, liveCourseId: true } } },
    });
    if (!video) return null;
    const { resolveVideoCourseId } = await import("../catalog-category-tree/category-tree.service");
    const [courseId, rows] = await Promise.all([
      resolveVideoCourseId(video.videoCategoryId),
      prisma.lectureProgress.findMany({ where: { customerId: input.customerId, videoId: input.videoId }, select: { positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } }),
    ]);
    const p = collapseRows(rows);
    const liveCourseId = video.VideoCategory?.liveCourseId ?? null;
    return {
      kind: "recorded", videoId: String(video.id), liveSessionId: null,
      title: video.title ?? null, topic: video.topic ?? null,
      lessonTitle: video.VideoCategory?.title ?? null,
      videoCategoryId: video.videoCategoryId ? String(video.videoCategoryId) : null,
      courseId: courseId ? String(courseId) : null,
      liveCourseId: liveCourseId ? String(liveCourseId) : null,
      resume: { positionSec: p?.positionSec ?? 0, durationSec: p?.durationSec ?? 0, completed: !!p?.completed, lastWatchedAt: p?.lastWatchedAt ?? null },
    };
  }
  const session = await prisma.liveSession.findFirst({ where: { id: input.liveSessionId }, select: { id: true, title: true, subject: true } });
  if (!session) return null;
  const link = await prisma.liveSessionCourse.findFirst({ where: { liveSessionId: input.liveSessionId }, select: { liveCourseId: true } });
  const rows = await prisma.lectureProgress.findMany({ where: { customerId: input.customerId, liveSessionId: input.liveSessionId }, select: { positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } });
  const p = collapseRows(rows);
  return {
    kind: "live", videoId: null, liveSessionId: String(session.id),
    title: session.title ?? null, topic: session.subject ?? null, lessonTitle: null, videoCategoryId: null, courseId: null,
    liveCourseId: link?.liveCourseId != null ? String(link.liveCourseId) : null,
    resume: { positionSec: p?.positionSec ?? 0, durationSec: p?.durationSec ?? 0, completed: !!p?.completed, lastWatchedAt: p?.lastWatchedAt ?? null },
  };
};

/**
 * The parent container's "resume now" hero card for the lecture in the query: recorded →
 * owning course; live → entitled live course. Same card semantics as listMyLearningProgress.
 */
export const buildResumeNextCardSql = async (input:
  | { lectureType: "recorded"; customerId: number; videoId: number }
  | { lectureType: "live"; customerId: number; liveSessionId: number }
): Promise<any | null> => {
  const now = new Date();
  if (input.lectureType === "recorded") {
    const { resolveVideoCourseId, reachableCategoryIds } = await import("../catalog-category-tree/category-tree.service");
    const video = await prisma.video.findFirst({ where: { id: input.videoId }, select: { videoCategoryId: true } });
    if (!video) return null;
    const courseId = await resolveVideoCourseId(video.videoCategoryId);
    if (!courseId) return null;
    const [course, rollup, sub, cats] = await Promise.all([
      prisma.course.findFirst({ where: { id: courseId }, select: { id: true, name: true, image: true, educator: { select: { id: true, name: true, image: true } } } }),
      rollupByContainer(input.customerId, "courseId").then((rs) => rs.find((r) => r._id === courseId)),
      prisma.packageCourseSubscription.findFirst({ where: { customerId: input.customerId, courseId, status: true, endAt: { gt: now } }, select: { endAt: true } }),
      reachableCategoryIds("course", courseId),
    ]);
    if (!course) return null;
    const total = await videosUnderCategories([...cats]);
    const lastVideoId = rollup?.lastVideoId ?? null;
    const lectureMap = lastVideoId ? await resolveLectures([lastVideoId]) : new Map();
    return {
      type: "course", id: String(course.id), courseId: String(course.id), liveCourseId: null, packageId: null,
      title: course.name, subtitle: course.educator?.name ? `By ${course.educator.name}` : null,
      educator: educatorOf(course.educator), thumbnail: course.image ?? null,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: pct(rollup?.completedCount ?? 0, total), completedLectures: rollup?.completedCount ?? 0, totalLectures: total,
      lastWatchedAt: rollup?.lastWatchedAt ?? null,
      lecture: lastVideoId ? lectureMap.get(lastVideoId) ?? null : null,
      resume: { videoId: lastVideoId ? String(lastVideoId) : null, liveSessionId: null, positionSec: rollup?.lastPositionSec ?? 0, durationSec: rollup?.lastDurationSec ?? 0 },
    };
  }
  const links = await prisma.liveSessionCourse.findMany({ where: { liveSessionId: input.liveSessionId }, select: { liveCourseId: true } });
  const liveCourseIds = links.map((l) => l.liveCourseId);
  if (!liveCourseIds.length) return null;
  const sub = await prisma.liveCourseSubscription.findFirst({ where: { customerId: input.customerId, liveCourseId: { in: liveCourseIds }, status: true, endAt: { gt: now } }, select: { liveCourseId: true, endAt: true } });
  const liveCourseId = sub?.liveCourseId ?? liveCourseIds[0];
  const [lc, rollup] = await Promise.all([
    prisma.liveCourse.findFirst({ where: { id: liveCourseId }, select: { id: true, name: true, image: true, educatorId: true } }),
    rollupByContainer(input.customerId, "liveCourseId").then((rs) => rs.find((r) => r._id === liveCourseId)),
  ]);
  if (!lc) return null;
  const total = await prisma.liveSessionCourse.count({ where: { liveCourseId } });
  const edu = lc.educatorId ? await prisma.courseEducator.findFirst({ where: { id: lc.educatorId }, select: { id: true, name: true, image: true } }) : null;
  return {
    type: "live", id: String(lc.id), liveCourseId: String(lc.id), courseId: null, packageId: null,
    title: lc.name, subtitle: edu?.name ? `By ${edu.name}` : null, educator: educatorOf(edu), thumbnail: lc.image ?? null,
    daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
    percentCompleted: pct(rollup?.completedCount ?? 0, total), completedLectures: rollup?.completedCount ?? 0, totalLectures: total,
    lastWatchedAt: rollup?.lastWatchedAt ?? null, lecture: null,
    resume: { videoId: null, liveSessionId: (rollup as any)?.lastLiveSessionId ? String((rollup as any).lastLiveSessionId) : String(input.liveSessionId), positionSec: rollup?.lastPositionSec ?? 0, durationSec: rollup?.lastDurationSec ?? 0 },
  };
};

/**
 * The most recent card of each container type, built on listMyLearningProgress so the
 * dashboard never disagrees with the resume feed. Adds `minutesLeft` per card.
 *
 * `resumeLecture` was the live-course slot and is always `null` now (live cards are excluded
 * at the source). The key is kept so the response shape the app parses is unchanged.
 */
export const buildResumeDashboard = async (customerId: number): Promise<{ resumeLecture: any; recentCourse: any; recentPackage: any }> => {
  const { cards } = await listMyLearningProgress(customerId);
  // Re-derives the video-centric `percentCompleted` defensively and adds `minutesLeft`.
  const withVideoProgress = (c: any) => {
    if (!c) return null;
    const dur = c.resume?.durationSec ?? 0, pos = c.resume?.positionSec ?? 0;
    return {
      ...c,
      percentCompleted: percentOf(pos, dur),
      minutesLeft: dur > 0 ? Math.max(0, Math.floor((dur - pos) / 60)) : 0,
    };
  };
  return {
    resumeLecture: null,
    recentCourse: withVideoProgress(cards.find((c: any) => c.type === "course")),
    recentPackage: withVideoProgress(cards.find((c: any) => c.type === "package")),
  };
};

/** Any price; used for the 404 vs 403 split. */
export const findLiveVideo = (videoId: number) =>
  prisma.video.findFirst({ where: { id: videoId, status: true }, select: { id: true, priceType: true } });
