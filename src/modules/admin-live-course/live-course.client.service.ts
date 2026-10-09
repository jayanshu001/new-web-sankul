// Live courses: client entitlement checks, plans and the course detail / my-courses reads.
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import type { LiveCoursePlan } from "@prisma/client";
import { matchesAllTokens } from "../../utils/searchFilter";
import { computeDaysLeft } from "../../utils/planDuration";
import { buildShareUrl } from "../../deeplinking/shareRedirect";
import { prisma } from "../../config/prisma";
import { jArr } from "./live-course.shared";
import { toCourseDto } from "./live-course.crud.service";

// Best (highest-resolution) MP4 url for the convenience `mp4Url` field; falls back to
// the first entry, or null.
const pickBestMp4 = (recs: Array<{ quality: string | null; path: string }>): string | null => {
  if (!recs.length) return null;
  const heightOf = (q: string | null) => Number(String(q ?? "").match(/(\d+)/)?.[1] ?? 0);
  return [...recs].sort((a, b) => heightOf(b.quality) - heightOf(a.quality))[0]?.path ?? recs[0].path ?? null;
};

/**
 * True when the customer holds an active subscription (status on, endAt null or not past)
 * to ANY of the given live courses. Guests (null customer) are never entitled.
 */
export const hasAccessToAnyLiveCourse = async (customerId: number | null, liveCourseIds: number[]): Promise<boolean> => {
  if (!customerId || !liveCourseIds.length) return false;
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, new Date());
  return subs.length > 0;
};

/**
 * Like hasAccessToAnyLiveCourse but reports the winning course for
 * `accessGrantedByLiveCourseId`. Resolves in the caller's id order so course-scoped
 * (single id) and Live Now (all linked ids) calls give a stable answer. null = none.
 */
export const firstEntitledLiveCourseId = async (
  customerId: number | null,
  liveCourseIds: number[]
): Promise<number | null> => {
  if (!customerId || !liveCourseIds.length) return null;
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, new Date());
  if (!subs.length) return null;
  const entitled = new Set(subs.map((s) => s.liveCourseId));
  return liveCourseIds.find((id) => entitled.has(id)) ?? null;
};

// Days left per course from active subs (null = lifetime); empty for guests.
export const getDaysLeftMap = async (customerId: number | null, liveCourseIds: number[]): Promise<Map<string, number | null>> => {
  const out = new Map<string, number | null>();
  if (!customerId || !liveCourseIds.length) return out;
  const now = new Date();
  const subs = await repo.activeSubsForCourses(customerId, liveCourseIds, now);
  const lifetime = new Set<string>();
  const latest = new Map<string, Date>();
  for (const s of subs) {
    const key = String(s.liveCourseId);
    if (s.endAt == null) { lifetime.add(key); continue; }
    const prev = latest.get(key);
    if (!prev || s.endAt.getTime() > prev.getTime()) latest.set(key, s.endAt);
  }
  for (const k of lifetime) out.set(k, null);
  for (const [k, end] of latest) if (!lifetime.has(k)) out.set(k, computeDaysLeft(end, now));
  return out;
};

/** Ids (as strings, matching DTO `_id`s) of every live course the customer is actively subscribed to. */
export const getOwnedCourseIds = async (customerId: number | null): Promise<Set<string>> => {
  if (!customerId) return new Set();
  return new Set((await repo.ownedCourseIds(customerId, new Date())).map(String));
};

/** Completed-order count per live course, keyed by string id; a sales measure, so renewals count. */
export const getPurchaseCounts = async (liveCourseIds: number[]): Promise<Map<string, number>> => {
  const m = await repo.purchaseCounts(liveCourseIds);
  return new Map([...m].map(([k, v]) => [String(k), v]));
};

// Plan DTO with originalPrice/discountPercent enrichment (matches the client listing).
const toClientPlan = (p: LiveCoursePlan) => {
  const original = p.originalPrice != null && p.originalPrice > p.price ? p.originalPrice : null;
  return {
    _id: String(p.id), liveCourseId: String(p.liveCourseId), name: p.name ?? null, duration: p.duration,
    price: p.price, originalPrice: original, discountPercent: original ? Math.round(((original - p.price) / original) * 100) : 0,
    withMaterial: p.withMaterial ?? false, materialPrice: p.materialPrice ?? null,
    isDefault: p.isDefault, status: p.status,
    isMostPopular: (p as any).isMostPopular ?? false,
  };
};

// packageCategoryId and courseEducatorId are surfaced as bare ids.
export const plansGrouped = async (courseIds: number[]) => {
  const plans = await repo.activePlansForCourses(courseIds);
  const byCourse = new Map<number, any[]>();
  for (const p of plans) { const a = byCourse.get(p.liveCourseId) ?? []; a.push(toClientPlan(p)); byCourse.set(p.liveCourseId, a); }
  return byCourse;
};

// { withMaterial, withoutMaterial } split used by the client course and live-course
// detail endpoints.
export const splitPlansByMaterial = (arr: any[]) => ({
  withMaterial: arr.filter((p) => p.withMaterial),
  withoutMaterial: arr.filter((p) => !p.withMaterial),
});

// courseEducatorId and packageCategoryId are populated. subjectsCount = schedule
// folders (JSON); materialsCount has no column → 0. Never returns playback URLs.
export const getLiveCourseDetailForClient = async (
  id: number,
  customerId: number | null,
  baseUrl?: string
): Promise<"not_found" | any> => {
  const row = await repo.findById(id);
  if (!row) return "not_found";

  const [educator, pkgCat, plansRaw, subscribed, daysLeftMap] = await Promise.all([
    row.educatorId != null ? repo.findEducator(row.educatorId) : Promise.resolve(null),
    row.packageCategoryId != null ? repo.findPackageCategory(row.packageCategoryId) : Promise.resolve(null),
    repo.listPlans(id),
    hasAccessToAnyLiveCourse(customerId, [id]),
    getDaysLeftMap(customerId, [id]),
  ]);

  // A deactivated live course stays hidden from non-owners, but active subscribers keep
  // full access to its detail and content.
  if (!row.status && !subscribed) return "not_found";

  const planList = plansRaw
    .filter((p) => p.status)
    .sort((a, b) => a.price - b.price)
    .map((p) => toClientPlan(p));
  // Split by material variant, same as the package detail contract
  // (catalog-package.detail.sql.ts).
  const plans = {
    withMaterial: planList.filter((p) => p.withMaterial),
    withoutMaterial: planList.filter((p) => !p.withMaterial),
  };

  const shareableLink = buildShareUrl("live-courses", String(id), baseUrl);
  const folders = jArr(row.scheduleFolders);
  const stats = { subjectsCount: folders.length, materialsCount: 0, classType: row.classType ?? "live" };
  const liveCourse = {
    ...toCourseDto(row),
    courseEducatorId: educator
      ? { _id: String(educator.id), name: educator.name, image: educator.image, about: educator.about }
      : null,
    packageCategoryId: pkgCat
      ? { _id: String(pkgCat.id), title: pkgCat.title, slug: pkgCat.slug, image: pkgCat.image }
      : null,
    isPaid: row.isPaid,
    shareableLink,
  };
  const daysLeft = daysLeftMap.has(String(id)) ? daysLeftMap.get(String(id)) ?? null : null;
  return { liveCourse, scope: { kind: "liveCourse", id: String(id) }, stats, plans, subscribed, isPaid: row.isPaid, isPurchased: subscribed, daysLeft, shareableLink };
};

// endAt sort key: a lifetime entitlement (endAt null) never expires → Infinity.
const subEndKey = (endAt: Date | null | undefined) => (endAt ? endAt.getTime() : Infinity);

/**
 * Collapse a customer's live-course subscription rows to one card per course. Extend
 * creates a new row (one order = one row), but "My live courses" is an entitlement
 * view: after Extend Validity the student sees one card whose validity moved out.
 * The winner is the strongest entitlement (currently active beats lapsed, then
 * furthest endAt) and carries plan + subscriptionId; the window spans the group's
 * earliest start and the furthest end among equally strong rows (lifetime wins).
 * Same collapse as getDaysLeftMap, so daysLeft matches every other surface.
 */
const mergeLiveSubsPerCourse = <
  T extends { id: number; liveCourseId: number | null; startAt: Date | null; endAt: Date | null; status: boolean | null }
>(rows: T[], now: Date): T[] => {
  // Is this row a live entitlement now? Only the "all" filter can mix ranks.
  const rank = (s: T) => (s.status === true && (s.endAt == null || s.endAt.getTime() >= now.getTime()) ? 1 : 0);

  const groups = new Map<string, T[]>();
  const order: string[] = []; // preserve the repository's createdAt-desc ordering
  for (const s of rows) {
    // Rows with no course attached can't be merged; keep them as-is.
    const key = s.liveCourseId != null && s.liveCourseId > 0 ? `l:${s.liveCourseId}` : `s:${s.id}`;
    const g = groups.get(key);
    if (g) g.push(s);
    else { groups.set(key, [s]); order.push(key); }
  }

  return order.map((key) => {
    const g = groups.get(key) as T[];
    if (g.length === 1) return g[0];

    const top = Math.max(...g.map(rank));
    const pool = g.filter((s) => rank(s) === top);
    const winner = pool.reduce((best, s) => (subEndKey(s.endAt) > subEndKey(best.endAt) ? s : best));

    const starts = g.map((s) => s.startAt).filter((d): d is Date => d != null);
    const startAt = starts.length ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
    const endAt = pool.some((s) => s.endAt == null)
      ? null
      : new Date(Math.max(...pool.map((s) => (s.endAt as Date).getTime())));

    return { ...winner, startAt, endAt };
  });
};

/**
 * Sessions behind the My Live Batches card: unit key → video ids. A unit is one class,
 * not one ws_video row: a recording filed into several folders must count once, so
 * live-linked rows collapse per live session and a manual video is its own unit. Only
 * playable rows count (source id present; a live-linked session is READY with
 * recordings), so scheduled / live / processing streams never reach the total.
 */
const recordingSessionUnits = async (folderIds: number[]): Promise<Map<string, number[]>> => {
  const units = new Map<string, number[]>();
  if (!folderIds.length) return units;
  const videos = (
    await prisma.video.findMany({
      where: { status: true, videoCategoryId: { in: folderIds } },
      select: { id: true, liveSessionId: true, aws_id: true, youtube_id: true, vimeo_id: true },
    })
  ).filter((v) => v.aws_id || v.youtube_id || v.vimeo_id);
  const sessionIds = [...new Set(videos.map((v) => v.liveSessionId).filter((n): n is number => n != null))];
  const sessions = sessionIds.length
    ? await prisma.liveSession.findMany({ where: { id: { in: sessionIds }, status: "READY" }, select: { id: true, recordings: true } })
    : [];
  const ready = new Set(sessions.filter((s) => Array.isArray(s.recordings) && s.recordings.length > 0).map((s) => s.id));
  for (const v of videos) {
    if (v.liveSessionId != null && !ready.has(v.liveSessionId)) continue;
    const key = v.liveSessionId != null ? `s:${v.liveSessionId}` : `v:${v.id}`;
    units.set(key, [...(units.get(key) ?? []), v.id]);
  }
  return units;
};

export const listMyLiveCoursesForClient = async (
  customerId: number,
  filterStatus: string,
  baseUrl?: string,
  q: { search?: string; page: number; limit: number } = { page: 1, limit: 20 }
) => {
  const now = new Date();
  const subs = mergeLiveSubsPerCourse(await repo.myLiveCourseSubs(customerId, filterStatus, now), now);
  const courseIds = [...new Set(subs.map((s) => s.liveCourseId).filter((n): n is number => n != null))];
  const planIds = [...new Set(subs.map((s) => s.planId).filter((n): n is number => n != null))];
  const [courses, plans] = await Promise.all([
    courseIds.length ? repo.coursesSlimByIds(courseIds) : Promise.resolve([]),
    planIds.length ? repo.plansByIds(planIds) : Promise.resolve([]),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const planById = new Map(plans.map((p) => [p.id, p]));

  // Educator names for the "By <educator>" card subtitle.
  const eduIds = [...new Set(courses.map((c) => c.educatorId).filter((n): n is number => n != null))];
  const educators = eduIds.length
    ? await prisma.courseEducator.findMany({ where: { id: { in: eduIds } }, select: { id: true, name: true, image: true } })
    : [];
  const eduById = new Map(educators.map((e) => [e.id, e]));

  // "X of Y sessions completed": a session is a recorded class (the unit progress
  // heartbeats drive), so the ratio stays <= 100%. total = playable classes under the
  // course's folders (recordingSessionUnits); completed = those finished in this
  // live-course container, any copy of a recording counting.
  const totalByCourse = new Map<number, number>();
  const doneByCourse = new Map<number, number>();
  await Promise.all(courseIds.map(async (id) => {
    const folders = await prisma.videoCategory.findMany({ where: { liveCourseId: id, status: true }, select: { id: true } });
    const units = [...(await recordingSessionUnits(folders.map((f) => f.id))).values()];
    const doneRows = units.length
      ? await prisma.lectureProgress.findMany({
          where: { customerId, liveCourseId: id, completed: true, videoId: { in: units.flat() } },
          select: { videoId: true },
        })
      : [];
    const doneIds = new Set(doneRows.map((r) => r.videoId));
    totalByCourse.set(id, units.length);
    doneByCourse.set(id, units.filter((ids) => ids.some((v) => doneIds.has(v))).length);
  }));

  const liveCourses = subs.map((s) => {
    const active = s.status === true && (s.endAt == null || new Date(s.endAt).getTime() >= now.getTime());
    const c = s.liveCourseId != null ? courseById.get(s.liveCourseId) : null;
    const p = s.planId != null ? planById.get(s.planId) : null;
    const edu = c?.educatorId != null ? eduById.get(c.educatorId) ?? null : null;
    const totalSessions = c ? totalByCourse.get(c.id) ?? 0 : 0;
    const completedSessions = c ? doneByCourse.get(c.id) ?? 0 : 0;
    return {
      subscriptionId: String(s.id),
      liveCourse: c
        ? {
            _id: String(c.id), name: c.name, image: c.image, isPaid: c.isPaid, status: c.status,
            educatorId: edu ? String(edu.id) : null,
            educatorName: edu?.name ?? null,
            shareableLink: buildShareUrl("live-courses", String(c.id), baseUrl),
          }
        : null,
      plan: p ? { _id: String(p.id), name: p.name, duration: p.duration, price: p.price } : null,
      startAt: s.startAt ?? null,
      endAt: s.endAt ?? null,
      // Rows are already gated to purchased subscriptions (LIVE_SUB_PURCHASED), so this is
      // always "verified"; kept so the DTO shape is unchanged.
      paymentStatus: "verified",
      active,
      daysLeft: active ? computeDaysLeft(s.endAt ?? null, now) : 0,
      progress: {
        completedSessions,
        totalSessions,
        percentCompleted: totalSessions > 0 ? Math.min(100, Math.round((completedSessions / totalSessions) * 100)) : 0,
      },
    };
  });
  // Rows are hydrated in memory, so search + pagination run over the assembled array.
  const filtered = q.search
    ? liveCourses.filter((c) => matchesAllTokens(q.search, [c.liveCourse?.name]))
    : liveCourses;
  const total = filtered.length;
  const paged = filtered.slice((q.page - 1) * q.limit, (q.page - 1) * q.limit + q.limit);
  return { liveCourses: paged, total, page: q.page, limit: q.limit };
};

// Active courses with their active plans (cheapest first) for purchase pickers.
export const buildPurchaseOptionsSql = async (courseIds: number[]) => {
  if (!courseIds.length) return [];
  const [courses, plans] = await Promise.all([
    prisma.liveCourse.findMany({ where: { id: { in: courseIds }, status: true }, select: { id: true, name: true, image: true } }),
    prisma.liveCoursePlan.findMany({ where: { liveCourseId: { in: courseIds }, status: true }, orderBy: { price: "asc" } }),
  ]);
  const byCourse = new Map<number, any[]>();
  for (const p of plans) { const a = byCourse.get(p.liveCourseId) ?? []; a.push(p); byCourse.set(p.liveCourseId, a); }
  return courses.map((c) => ({
    liveCourseId: String(c.id), name: c.name, image: c.image,
    plans: (byCourse.get(c.id) ?? []).map((p) => ({ planId: String(p.id), name: p.name ?? null, duration: p.duration, price: p.price, isDefault: p.isDefault })),
  }));
};
