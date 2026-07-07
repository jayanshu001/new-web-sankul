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
export const isLectureProgressMysql = (): boolean => true;

/**
 * Dedicated sub-flag for the CONTAINER (course/package/liveCourse) progress path
 * — heartbeat writes + resume/learning reads. Kept separate from the base
 * free-slice flag because the container heartbeat write and the resume/learning
 * READ hub MUST flip together (enabling one alone splits progress data across
 * SQL/Mongo). Flip `lecture-progress-container` only when the whole hub is ready.
 */
export const LECTURE_PROGRESS_CONTAINER_MODULE = "lecture-progress-container";
export const isLectureProgressContainerMysql = (): boolean => true;

export const parseLpId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const COMPLETION_THRESHOLD = 0.95;
const isComplete = (pos: number, dur: number) => dur > 0 && pos / dur >= COMPLETION_THRESHOLD;

const sid = (n: number | null | undefined) => (n == null ? null : String(n));

/**
 * SQL LectureProgress row → the Mongo document shape the player expects
 * (`_id`, stringified ObjectId-style ids). Keeps the heartbeat response
 * byte-compatible across backends.
 */
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

const percentOf = (pos: number, dur: number) =>
  dur > 0 ? Math.min(100, Math.round((pos / dur) * 100)) : 0;

/**
 * Free-video "Resume Learning" feed (SQL). Self-contained slice: only joins
 * ws_video (must still be live + priceType=free) and ws_video_category
 * (title/image) — NO container/DAG/subscription joins. Mirrors the Mongo
 * listFreeVideoResume card shape exactly so the controller envelope is unchanged.
 */
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
  // Only videos still live AND still free (a flip to paid/disabled drops them,
  // matching the Mongo feed — tapping would 403 at /courses/lecture). `search`
  // (video title) is pushed into the Prisma where so non-matching videos are
  // simply absent from `byId` and drop out of the built cards.
  const videoWhere: any = { id: { in: videoIds }, status: true, priceType: "free" };
  if (opts.search) videoWhere.title = { contains: opts.search };
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

  // Hero card is the single most-recent match regardless of the requested page;
  // `cards` is the paginated slice. `total` counts all matching cards.
  const total = allCards.length;
  const cards = allCards.slice(skip, skip + limit);
  return { cards, resumeNext: allCards[0] ?? null, total };
};

/**
 * Container heartbeat (course/package/liveCourse) on SQL — the int-space mirror
 * of course/progress.controller.reportLectureProgress. Reachability uses the SQL
 * DAG resolver (catalog-category-tree); entitlement uses the SQL subscription
 * tables. Returns a discriminated result the controller maps to its HTTP shape.
 *
 * ⚠ Drift parity (documented): ws_package_course_subscription has NO
 * payment_status column → the Mongo `paymentStatus:"verified"` gate collapses to
 * `status=true` (same rule as commerce-subscription). ws_live_course_subscription
 * DOES have payment_status, so the live gate keeps the verified check.
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

  // Reachability — same question the catalog answers (DAG down-walk off the
  // product's linked roots). Free videos are exempt (surfaced via free catalog).
  const reachable = await reachableCategoryIds(input.scope.kind, input.scope.id);
  const leaf = video.videoCategoryId ?? null;
  const videoReachable = isFree || (leaf != null && reachable.has(leaf));

  const labels = { course: "course", package: "package", liveCourse: "live course" } as const;
  if (!videoReachable) {
    return { ok: false, status: 400, message: `Video is not part of the scoped ${labels[input.scope.kind]}.` };
  }

  // Entitlement gate per kind. Free videos only need the container to exist.
  if (input.scope.kind === "course") {
    if (isFree) {
      const c = await prisma.course.findFirst({ where: { id: input.scope.id, status: true }, select: { id: true } });
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
      const p = await prisma.package.findFirst({ where: { id: input.scope.id, active: true }, select: { id: true } });
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
      const lc = await prisma.liveCourse.findFirst({ where: { id: input.scope.id, status: true }, select: { id: true } });
      if (!lc) return { ok: false, status: 404, message: "Live course not found." };
    } else {
      const sub = await prisma.liveCourseSubscription.findFirst({
        where: { customerId: input.customerId, liveCourseId: input.scope.id, status: true, paymentStatus: "verified", endAt: { gt: now } },
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
  return { ok: true, row };
};

/**
 * Live-session container heartbeat on SQL — int-space mirror of
 * learning/progress.controller.reportLiveSessionProgress. Entitlement: an active
 * verified LiveCourseSubscription for ANY live course the session is published
 * under (ws_live_session_course join). Stamps the first matching liveCourseId.
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
    where: { customerId: input.customerId, liveCourseId: { in: liveCourseIds }, status: true, paymentStatus: "verified", endAt: { gt: now } },
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
  return { ok: true, row };
};

// ── Resume / Learning READ hub (SQL) ─────────────────────────────────────────
const daysLeftOf = (endAt: Date | null | undefined, now: Date) =>
  endAt ? Math.max(0, Math.ceil((new Date(endAt).getTime() - now.getTime()) / 86_400_000)) : null;
const pct = (done: number, total: number) => (total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0);
const educatorOf = (e: any) => (e ? { id: String(e.id), name: e.name ?? null, image: e.image ?? null } : null);

/** Count active videos directly under a set of category ids. */
const videosUnderCategories = async (catIds: number[]): Promise<number> => {
  if (!catIds.length) return 0;
  return prisma.video.count({ where: { status: true, videoCategoryId: { in: catIds } } });
};

/**
 * Per-container total published-lecture counts (the % bar denominator).
 * course/package → videos under the container's reachable category tree (DAG
 * resolver); liveCourse → number of sessions published under it.
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

/** Resolve lecture cards (video → title/topic/chapter) for the resume targets. */
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

/**
 * Unified "Resume Learning" feed (course + package + live cards), SQL mirror of
 * learning/progress.controller.listMyLearningProgress. Returns { cards, resumeNext }.
 *
 * `percentCompleted` is VIDEO-centric — progress through the last-watched lecture
 * (`percentOf(lastPositionSec, lastDurationSec)`), not course/package-wide completion.
 * `completedLectures`/`totalLectures` remain the container-wide counts for analytics.
 */
export const listMyLearningProgress = async (customerId: number): Promise<{ cards: any[]; resumeNext: any }> => {
  const now = new Date();
  const [perCourse, perPackage, perLive] = await Promise.all([
    rollupByContainer(customerId, "courseId"),
    rollupByContainer(customerId, "packageId"),
    rollupByContainer(customerId, "liveCourseId"),
  ]);

  const courseIds = perCourse.map((r) => r._id);
  const packageIds = perPackage.map((r) => r._id);
  const liveIds = perLive.map((r) => r._id);

  const [courses, packages, liveCourses, courseSubs, packageSubs, liveSubs, totals] = await Promise.all([
    courseIds.length ? prisma.course.findMany({ where: { id: { in: courseIds }, status: true }, select: { id: true, name: true, image: true, educator: { select: { id: true, name: true, image: true } } } }) : [],
    packageIds.length ? prisma.package.findMany({ where: { id: { in: packageIds }, active: true }, select: { id: true, name: true, image: true, educator_id: true } }) : [],
    liveIds.length ? prisma.liveCourse.findMany({ where: { id: { in: liveIds }, status: true }, select: { id: true, name: true, image: true, educatorId: true } }) : [],
    courseIds.length ? prisma.packageCourseSubscription.findMany({ where: { customerId, courseId: { in: courseIds }, status: true, endAt: { gt: now } }, select: { courseId: true, endAt: true } }) : [],
    packageIds.length ? prisma.packageCourseSubscription.findMany({ where: { customerId, packageId: { in: packageIds }, status: true, endAt: { gt: now } }, select: { packageId: true, endAt: true } }) : [],
    liveIds.length ? prisma.liveCourseSubscription.findMany({ where: { customerId, liveCourseId: { in: liveIds }, status: true, paymentStatus: "verified", endAt: { gt: now } }, select: { liveCourseId: true, endAt: true } }) : [],
    containerTotals(courseIds, packageIds, liveIds),
  ]);

  // Educators for packages + live courses (Course has its relation inline).
  const eduIds = [...new Set([...packages.map((p) => p.educator_id), ...liveCourses.map((l) => l.educatorId)].filter((x) => x != null))] as number[];
  const educators = eduIds.length ? await prisma.courseEducator.findMany({ where: { id: { in: eduIds } }, select: { id: true, name: true, image: true } }) : [];
  const eduById = new Map(educators.map((e) => [e.id, e]));

  const courseById = new Map(courses.map((c) => [c.id, c]));
  const packageById = new Map(packages.map((p) => [p.id, p]));
  const liveById = new Map(liveCourses.map((l) => [l.id, l]));
  const courseSubBy = new Map(courseSubs.map((s) => [s.courseId!, s]));
  const packageSubBy = new Map(packageSubs.map((s) => [s.packageId!, s]));
  const liveSubBy = new Map(liveSubs.map((s) => [s.liveCourseId, s]));

  const lectureMap = await resolveLectures([...perCourse, ...perPackage, ...perLive].map((p) => p.lastVideoId).filter(Boolean));
  const sessionMap = await resolveSessions(perLive.map((p: any) => p.lastLiveSessionId).filter(Boolean));

  const cards: any[] = [];
  for (const p of perCourse) {
    const c = courseById.get(p._id); if (!c) continue;
    const sub = courseSubBy.get(p._id); const total = totals.courseTotal.get(p._id) ?? 0;
    cards.push({
      type: "course", id: String(c.id), courseId: String(c.id), liveCourseId: null, packageId: null,
      title: c.name, subtitle: c.educator?.name ? `By ${c.educator.name}` : null,
      educator: educatorOf(c.educator), thumbnail: c.image ?? null,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(p.lastPositionSec, p.lastDurationSec), completedLectures: p.completedCount, totalLectures: total,
      lastWatchedAt: p.lastWatchedAt, lecture: p.lastVideoId ? lectureMap.get(p.lastVideoId) ?? null : null,
      resume: { videoId: p.lastVideoId ? String(p.lastVideoId) : null, liveSessionId: null, positionSec: p.lastPositionSec, durationSec: p.lastDurationSec },
    });
  }
  for (const p of perPackage) {
    const pkg = packageById.get(p._id); if (!pkg) continue;
    const sub = packageSubBy.get(p._id); const total = totals.packageTotal.get(p._id) ?? 0;
    cards.push({
      type: "package", id: String(pkg.id), packageId: String(pkg.id), courseId: p.lastCourseId ? String(p.lastCourseId) : null, liveCourseId: null,
      title: pkg.name, subtitle: pkg.educator_id && eduById.get(pkg.educator_id)?.name ? `By ${eduById.get(pkg.educator_id)!.name}` : null,
      educator: pkg.educator_id ? educatorOf(eduById.get(pkg.educator_id)) : null, thumbnail: pkg.image ?? null,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(p.lastPositionSec, p.lastDurationSec), completedLectures: p.completedCount, totalLectures: total,
      lastWatchedAt: p.lastWatchedAt, lecture: p.lastVideoId ? lectureMap.get(p.lastVideoId) ?? null : null,
      resume: { videoId: p.lastVideoId ? String(p.lastVideoId) : null, liveSessionId: null, positionSec: p.lastPositionSec, durationSec: p.lastDurationSec },
    });
  }
  for (const p of perLive as any[]) {
    const lc = liveById.get(p._id); if (!lc) continue;
    const sub = liveSubBy.get(p._id); const total = totals.liveTotal.get(p._id) ?? 0;
    const edu = lc.educatorId ? eduById.get(lc.educatorId) : null;
    cards.push({
      type: "live", id: String(lc.id), liveCourseId: String(lc.id), courseId: null, packageId: null,
      title: lc.name, subtitle: edu?.name ? `By ${edu.name}` : null, educator: educatorOf(edu), thumbnail: lc.image ?? null,
      daysLeft: daysLeftOf(sub?.endAt, now), subscriptionEndAt: sub?.endAt ?? null,
      percentCompleted: percentOf(p.lastPositionSec, p.lastDurationSec), completedLectures: p.completedCount, totalLectures: total,
      lastWatchedAt: p.lastWatchedAt,
      lecture: (p.lastLiveSessionId ? sessionMap.get(p.lastLiveSessionId) : null) ?? (p.lastVideoId ? lectureMap.get(p.lastVideoId) : null) ?? null,
      resume: { videoId: p.lastVideoId ? String(p.lastVideoId) : null, liveSessionId: p.lastLiveSessionId ? String(p.lastLiveSessionId) : null, positionSec: p.lastPositionSec, durationSec: p.lastDurationSec },
    });
  }
  cards.sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());
  return { cards, resumeNext: cards[0] ?? null };
};

/**
 * "My Courses" resume feed (course-only), SQL mirror of
 * course/progress.controller.listMyCoursesForResume → { courses, resumeNext }.
 */
export const listMyCoursesForResume = async (
  customerId: number,
  opts: { search?: string; skip?: number; limit?: number } = {}
): Promise<{ courses: any[]; resumeNext: any; total: number }> => {
  const now = new Date();
  const perCourse = (await rollupByContainer(customerId, "courseId"))
    .sort((a, b) => new Date(b.lastWatchedAt).getTime() - new Date(a.lastWatchedAt).getTime());
  if (!perCourse.length) return { courses: [], resumeNext: null, total: 0 };

  // Resolve the course rows for every started course first — the names drive the
  // optional `search` filter, and the active-status check drops orphaned rows.
  const allCourseIds = perCourse.map((p) => p._id);
  const activeCourses = await prisma.course.findMany({
    where: { id: { in: allCourseIds }, status: true },
    select: { id: true, name: true, image: true },
  });
  const courseById = new Map(activeCourses.map((c) => [c.id, c]));

  // Candidate cards = started + active, optionally name-filtered; paginate the
  // resolved array (total = full match count).
  const search = opts.search?.trim().toLowerCase();
  let candidates = perCourse.filter((p) => courseById.has(p._id));
  if (search) {
    candidates = candidates.filter((p) =>
      (courseById.get(p._id)?.name ?? "").toLowerCase().includes(search)
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

// ── Lecture-ref + resume-next builders (SQL) — used by the notes lists ────────
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

/** SQL buildLectureRef — the exact video/session a notes list belongs to. */
export const buildLectureRefSql = async (input:
  | { lectureType: "recorded"; customerId: number; videoId: number }
  | { lectureType: "live"; customerId: number; liveSessionId: number }
): Promise<any | null> => {
  if (input.lectureType === "recorded") {
    const video = await prisma.video.findFirst({
      where: { id: input.videoId },
      select: { id: true, title: true, topic: true, videoCategoryId: true, VideoCategory: { select: { title: true } } },
    });
    if (!video) return null;
    const { resolveVideoCourseId } = await import("../catalog-category-tree/category-tree.service");
    const [courseId, rows] = await Promise.all([
      resolveVideoCourseId(video.videoCategoryId),
      prisma.lectureProgress.findMany({ where: { customerId: input.customerId, videoId: input.videoId }, select: { positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } }),
    ]);
    const p = collapseRows(rows);
    return {
      kind: "recorded", videoId: String(video.id), liveSessionId: null,
      title: video.title ?? null, topic: video.topic ?? null,
      lessonTitle: video.VideoCategory?.title ?? null,
      videoCategoryId: video.videoCategoryId ? String(video.videoCategoryId) : null,
      courseId: courseId ? String(courseId) : null,
      resume: { positionSec: p?.positionSec ?? 0, durationSec: p?.durationSec ?? 0, completed: !!p?.completed, lastWatchedAt: p?.lastWatchedAt ?? null },
    };
  }
  const session = await prisma.liveSession.findFirst({ where: { id: input.liveSessionId }, select: { id: true, title: true, subject: true } });
  if (!session) return null;
  const rows = await prisma.lectureProgress.findMany({ where: { customerId: input.customerId, liveSessionId: input.liveSessionId }, select: { positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true } });
  const p = collapseRows(rows);
  return {
    kind: "live", videoId: null, liveSessionId: String(session.id),
    title: session.title ?? null, topic: session.subject ?? null, lessonTitle: null, videoCategoryId: null, courseId: null,
    resume: { positionSec: p?.positionSec ?? 0, durationSec: p?.durationSec ?? 0, completed: !!p?.completed, lastWatchedAt: p?.lastWatchedAt ?? null },
  };
};

/**
 * SQL buildResumeNextCard — the parent container's "resume now" hero card for
 * the lecture in the query. Recorded → owning course; live → entitled live course.
 * Reuses listMyLearningProgress's card semantics scoped to one container.
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
      prisma.course.findFirst({ where: { id: courseId, status: true }, select: { id: true, name: true, image: true, educator: { select: { id: true, name: true, image: true } } } }),
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
  // live
  const links = await prisma.liveSessionCourse.findMany({ where: { liveSessionId: input.liveSessionId }, select: { liveCourseId: true } });
  const liveCourseIds = links.map((l) => l.liveCourseId);
  if (!liveCourseIds.length) return null;
  const sub = await prisma.liveCourseSubscription.findFirst({ where: { customerId: input.customerId, liveCourseId: { in: liveCourseIds }, status: true, paymentStatus: "verified", endAt: { gt: now } }, select: { liveCourseId: true, endAt: true } });
  const liveCourseId = sub?.liveCourseId ?? liveCourseIds[0];
  const [lc, rollup] = await Promise.all([
    prisma.liveCourse.findFirst({ where: { id: liveCourseId, status: true }, select: { id: true, name: true, image: true, educatorId: true } }),
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
 * getResumeDashboard on SQL: { resumeLecture (live), recentCourse, recentPackage }
 * — the most-recent card of each container type. Built ON TOP of
 * listMyLearningProgress so the dashboard never disagrees with the resume feed
 * (the explicit invariant in dashboard.controller). Adds `minutesLeft` per card.
 */
export const buildResumeDashboard = async (customerId: number): Promise<{ resumeLecture: any; recentCourse: any; recentPackage: any }> => {
  const { cards } = await listMyLearningProgress(customerId);
  // Dashboard resume cards show VIDEO-centric progress — `percentCompleted` reflects
  // how far through the current/last-watched lecture the user is
  // (`positionSec / durationSec`), NOT course/package-wide completion.
  // `listMyLearningProgress` already produces video-centric `percentCompleted`; this
  // re-derivation is kept as a defensive, self-documenting guarantee for the dashboard
  // and to add `minutesLeft`. `completedLectures`/`totalLectures` are preserved for
  // analytics/the Progress screen. See docs/client/DASHBOARD_RESUME_PROGRESS.md.
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
    resumeLecture: withVideoProgress(cards.find((c: any) => c.type === "live")),
    recentCourse: withVideoProgress(cards.find((c: any) => c.type === "course")),
    recentPackage: withVideoProgress(cards.find((c: any) => c.type === "package")),
  };
};

/**
 * Per-video resume badges (positionSec/durationSec/completed/lastWatchedAt) for
 * a customer over a set of videoIds. Shared by the inline "Continue" sliver in
 * catalog/course/live-recordings listings. Returns a Map keyed by videoId.
 */
export const progressBadgesByVideo = async (
  customerId: number,
  videoIds: number[]
): Promise<Map<number, any>> => {
  if (!videoIds.length) return new Map();
  const rows = await prisma.lectureProgress.findMany({
    where: { customerId, videoId: { in: videoIds } },
    select: { videoId: true, positionSec: true, durationSec: true, completed: true, completedAt: true, lastWatchedAt: true },
  });
  return new Map(rows.map((r) => [r.videoId!, r]));
};

/** Validate a free video for the heartbeat: exists + live + priceType=free. */
export const findFreeVideo = (videoId: number) =>
  prisma.video.findFirst({
    where: { id: videoId, status: true, priceType: "free" },
    select: { id: true },
  });

/** Does the video exist at all (live), regardless of price? (404 vs 403 split) */
export const findLiveVideo = (videoId: number) =>
  prisma.video.findFirst({ where: { id: videoId, status: true }, select: { id: true, priceType: true } });
