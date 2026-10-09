// Live courses: client listings, session feeds and client schedule reads.
import { adminLiveCourseRepository as repo } from "./admin-live-course.repository";
import type { Prisma } from "@prisma/client";
import { buildPrismaSearch } from "../../utils/searchFilter";
import { formatScheduledAt } from "../../utils/displayTime";
import { prisma } from "../../config/prisma";
import { getDaysLeftMap, getOwnedCourseIds, getPurchaseCounts, plansGrouped, splitPlansByMaterial } from "./live-course.client.service";
import { listSessionsForCourse, toCourseDto } from "./live-course.crud.service";
import { PREVIEW_SECONDS as LIVE_PREVIEW_SECONDS, previewLevelMapSql } from "./live-course.preview.service";
import { jArr, toSessionDto } from "./live-course.shared";

// Client listing with daysLeft/isPurchased/plans; top-2 upcoming by sales get hero card variants.
export const listClient = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const now = Date.now();
  const [rows, total] = await Promise.all([
    repo.listClientCourses({ search: q.search, now: new Date(), sort: "ordered", skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countClientCourses({ search: q.search, now: new Date() }),
  ]);
  const ids = rows.map((r) => r.id);
  const [daysLeft, counts, owned, plans] = await Promise.all([getDaysLeftMap(customerId, ids), getPurchaseCounts(ids), getOwnedCourseIds(customerId), plansGrouped(ids)]);
  // Hero ranking: top-2 upcoming by purchase count.
  const upcoming = rows.filter((r) => r.startTime && r.startTime.getTime() > now).map((r) => ({ id: String(r.id), score: counts.get(String(r.id)) ?? 0 })).sort((a, b) => b.score - a.score);
  const featuredId = upcoming[0]?.id ?? null, comingSoonId = upcoming[1]?.id ?? null;
  const liveCourses = rows.map((r) => {
    const key = String(r.id);
    return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: owned.has(key), purchaseCount: counts.get(key) ?? 0, cardVariant: key === featuredId ? "featured" : key === comingSoonId ? "coming_soon" : null, plans: splitPlansByMaterial(plans.get(r.id) ?? []) };
  });
  return { liveCourses, total, page: q.page, limit: q.limit };
};

// Newest active live courses (createdAt desc, not the listing's ordered-first sort),
// with the same plans / daysLeft / isPurchased contract as listClient so cards agree.
// No hero ranking.
export const listRecentLiveCourses = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const where: Prisma.LiveCourseWhereInput = { status: true };
  const nameSearch = buildPrismaSearch(q.search, ["name"]);
  if (nameSearch) Object.assign(where, nameSearch);
  const [rows, total] = await Promise.all([
    prisma.liveCourse.findMany({ where, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.limit, take: q.limit }),
    prisma.liveCourse.count({ where }),
  ]);
  const ids = rows.map((r) => r.id);
  if (!ids.length) return { liveCourses: [], total, page: q.page, limit: q.limit };
  const [daysLeft, owned, plans] = await Promise.all([
    getDaysLeftMap(customerId, ids),
    getOwnedCourseIds(customerId),
    plansGrouped(ids),
  ]);
  const liveCourses = rows.map((r) => {
    const key = String(r.id);
    return {
      ...toCourseDto(r),
      daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null,
      isPurchased: owned.has(key),
      plans: plans.get(r.id) ?? [],
    };
  });
  return { liveCourses, total, page: q.page, limit: q.limit };
};

export const listUpcomingBatches = async (customerId: number | null, q: { search?: string; categoryId?: number; page: number; limit: number }) => {
  const now = new Date();
  const [rows, total, catCounts] = await Promise.all([
    repo.listClientCourses({ search: q.search, upcomingOnly: true, packageCategoryId: q.categoryId, now, sort: "startTime", skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countClientCourses({ search: q.search, upcomingOnly: true, packageCategoryId: q.categoryId, now }),
    repo.upcomingCategoryCounts(now),
  ]);
  const ids = rows.map((r) => r.id);
  const [daysLeft, counts, owned] = await Promise.all([getDaysLeftMap(customerId, ids), getPurchaseCounts(ids), getOwnedCourseIds(customerId)]);
  const liveBatches = rows.map((r) => { const key = String(r.id); return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: owned.has(key), purchaseCount: counts.get(key) ?? 0 }; });
  // Category tab bar from ws_package_category; unknown ids fall back to nulls. The
  // "All" count is the sum.
  const catRows = await repo.packageCategoriesByIds([...catCounts.keys()]);
  const catById = new Map(catRows.map((c) => [c.id, c]));
  const categories = [...catCounts].map(([catId, count]) => {
    const c = catById.get(catId);
    return { _id: String(catId), title: c?.title ?? null, slug: c?.slug ?? null, image: c?.image ?? null, count };
  });
  const allCount = [...catCounts.values()].reduce((n, c) => n + c, 0);
  return { liveBatches, total, page: q.page, limit: q.limit, categories, allCount, selectedCategoryId: q.categoryId ? String(q.categoryId) : null };
};

// Courses the customer currently owns, with daysLeft and plans.
export const listMyCourses = async (customerId: number | null) => {
  if (!customerId) return { liveCourses: [], total: 0 };
  const ownedIds = await repo.ownedCourseIds(customerId, new Date());
  const [rows, daysLeft, plans] = await Promise.all([repo.coursesByIdsActive(ownedIds), getDaysLeftMap(customerId, ownedIds), plansGrouped(ownedIds)]);
  const liveCourses = rows.map((r) => { const key = String(r.id); return { ...toCourseDto(r), daysLeft: daysLeft.has(key) ? daysLeft.get(key) ?? null : null, isPurchased: true, plans: plans.get(r.id) ?? [] }; });
  return { liveCourses, total: liveCourses.length };
};

/**
 * One row per physical session (repo dedupes shared sessions), carrying all linked
 * courses. Entitlement fields (`liveCourses[].isPurchased`, `subscribed`, `accessLevel`)
 * are resolved in two batched queries per page and are UI hints only; GET
 * /client/live-sessions/:id re-runs the real gate.
 */
const sessionFeed = async (
  courseIds: number[],
  customerId: number | null,
  mode: "upcoming" | "liveNow",
  search: string | undefined,
  page: number,
  limit: number
) => {
  const { rows, total, courseBySession } = await repo.sessionsForCourses(courseIds, { upcoming: mode === "upcoming", liveNow: mode === "liveNow", search, now: new Date(), skip: (page - 1) * limit, take: limit });
  if (!rows.length) return { sessions: [], total, page, limit };

  const linkedIds = [...new Set(rows.flatMap((s) => courseBySession.get(s.id) ?? []))];
  const [courses, owned, previewLevels] = await Promise.all([
    linkedIds.length
      ? prisma.liveCourse.findMany({ where: { id: { in: linkedIds } }, select: { id: true, name: true, image: true } })
      : Promise.resolve([] as { id: number; name: string; image: string | null }[]),
    getOwnedCourseIds(customerId),
    previewLevelMapSql(customerId, rows.map((s) => s.id)),
  ]);
  const courseById = new Map(courses.map((c) => [c.id, c]));

  const sessions = rows.map((s) => {
    const ids = courseBySession.get(s.id) ?? [];
    const liveCourses = ids
      .map((id) => courseById.get(id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ _id: String(c.id), name: c.name, image: c.image ?? null, isPurchased: owned.has(String(c.id)) }));
    // Owning any linked course is full access. A session with no linked course is
    // ungated, matching the detail endpoint.
    const subscribed = ids.length === 0 || liveCourses.some((c) => c.isPurchased);
    return {
      ...toSessionDto(s),
      sessionId: String(s.id),
      liveCourseIds: ids.map(String),
      liveCourses,
      subscribed,
      // Same numbers as the detail endpoint: full → 0, untouched trial → the whole
      // allowance, partly used → what is left (read-only).
      accessLevel: subscribed ? "full" : previewLevels.get(s.id)?.accessLevel ?? "preview",
      previewSecondsRemaining: subscribed ? 0 : previewLevels.get(s.id)?.previewSecondsRemaining ?? LIVE_PREVIEW_SECONDS,
    };
  });
  return { sessions, total, page, limit };
};

// Safety ceilings, not page sizes: the feeds page in sessionFeed, and a course's
// timetable is returned whole.
const MAX_FEED_COURSES = 1000;
const MAX_TIMETABLE_SESSIONS = 500;

export const listAllUpcomingSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  // Discovery feed: upcoming sessions of every active course.
  const all = await repo.listClientCourses({ now: new Date(), sort: "ordered", skip: 0, take: MAX_FEED_COURSES });
  return sessionFeed(all.map((c) => c.id), customerId, "upcoming", q.search, q.page, q.limit);
};

export const listLiveNowSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  const all = await repo.listClientCourses({ now: new Date(), sort: "ordered", skip: 0, take: MAX_FEED_COURSES });
  return sessionFeed(all.map((c) => c.id), customerId, "liveNow", q.search, q.page, q.limit);
};

export const listMyUpcomingSessions = async (customerId: number | null, q: { search?: string; page: number; limit: number }) => {
  if (!customerId) return { sessions: [], total: 0, page: q.page, limit: q.limit };
  const owned = await repo.ownedCourseIds(customerId, new Date());
  return sessionFeed(owned, customerId, "upcoming", q.search, q.page, q.limit);
};

export const listSessionsForCourseClient = async (id: number, q: { status?: string; upcoming?: string; search?: string; page?: string; limit?: string }): Promise<"not_found" | { sessions: any[]; total: number; page: number; limit: number }> => {
  return listSessionsForCourse(id, q); // same shape as the admin sessions-for-course
};

export const getScheduleFolderForClient = async (id: number, folderId: string): Promise<"not_found" | "folder_not_found" | { scheduleFolder: any }> => {
  const row = await repo.findById(id);
  if (!row || !row.status) return "not_found";
  const folder = jArr(row.scheduleFolders).find((f: any) => String(f._id) === folderId);
  if (!folder) return "folder_not_found";
  return { scheduleFolder: { _id: folder._id, title: folder.title, image: folder.image ?? null, order: folder.order ?? 0, status: folder.status !== false, entries: [...(folder.entries ?? [])].sort((x: any, y: any) => (x.order ?? 0) - (y.order ?? 0)) } };
};

// timetable = sessions with a scheduledAt (session educator from
// ws_live_session.educator_id, populated), scheduleFolders = the course's active
// folder JSON, plus daysLeft.
export const getScheduleForClient = async (
  courseId: number,
  customerId: number | null,
  upcoming: boolean
): Promise<"not_found" | { liveCourse: { _id: string; name: string }; timetable: any[]; scheduleFolders: any[]; total: number; daysLeft: number | null }> => {
  const course = await repo.findById(courseId);
  if (!course || !course.status) return "not_found";

  const now = new Date();
  const { rows } = await repo.sessionsForCourse(courseId, { upcoming, now, skip: 0, take: MAX_TIMETABLE_SESSIONS });
  const sched = rows.filter((s) => s.scheduledAt != null);
  // upcoming → ascending; otherwise future-first (nearest), then past most-recent-first.
  const ordered = upcoming
    ? sched.sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())
    : sched.sort((a, b) => {
        const fa = a.scheduledAt!.getTime() >= now.getTime() ? 0 : 1;
        const fb = b.scheduledAt!.getTime() >= now.getTime() ? 0 : 1;
        if (fa !== fb) return fa - fb;
        return Math.abs(a.scheduledAt!.getTime() - now.getTime()) - Math.abs(b.scheduledAt!.getTime() - now.getTime());
      });

  const eduIds = [...new Set(ordered.map((s) => s.educatorId).filter((n): n is number => n != null))];
  const eduById = new Map<number, { _id: string; name: string | null; image: string | null }>();
  if (eduIds.length) {
    const edus = await Promise.all(eduIds.map((eid) => repo.findEducator(eid)));
    for (const e of edus) if (e) eduById.set(e.id, { _id: String(e.id), name: e.name ?? null, image: e.image ?? null });
  }

  const timetable = ordered.map((s) => ({
    sessionId: String(s.id),
    subject: s.subject || s.title,
    title: s.title,
    educator: s.educatorId != null ? eduById.get(s.educatorId) ?? null : null,
    date: s.scheduledAt ?? null,
    startAt: s.scheduledAt ?? null,
    startAtDisplay: formatScheduledAt(s.scheduledAt),
    endAt: s.endAt ?? null,
    status: s.status,
    streamId: s.streamId ?? null,
  }));

  const scheduleFolders = jArr(course.scheduleFolders)
    .filter((f: any) => f.status !== false)
    .slice()
    .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
    .map((f: any) => ({
      _id: String(f._id),
      title: f.title,
      image: f.image ?? null,
      order: f.order ?? 0,
      status: f.status !== false,
      entries: (f.entries ?? []).slice().sort(
        (a: any, b: any) => ((a.order ?? 0) - (b.order ?? 0)) || (new Date(a.date).getTime() - new Date(b.date).getTime())
      ),
    }));

  const daysLeftMap = await getDaysLeftMap(customerId, [courseId]);
  const daysLeft = daysLeftMap.has(String(courseId)) ? daysLeftMap.get(String(courseId)) ?? null : null;

  return { liveCourse: { _id: String(course.id), name: course.name }, timetable, scheduleFolders, total: timetable.length, daysLeft };
};

// For every owned live course, its active schedule folders + daysLeft. This is a
// home-screen navigation list and the nav DTO strips `entryCount`, so every row must
// lead somewhere: a folder counts only when visible (status !== false) and holding at
// least one entry. Empty folders are dropped, and a course with none is dropped.
export const listMyScheduleForClient = async (customerId: number) => {
  const now = new Date();
  const ownedIds = await repo.ownedCourseIds(customerId, now);
  if (!ownedIds.length) return { liveCourses: [], totalLiveCourses: 0 };
  const [courses, daysLeftMap] = await Promise.all([
    prisma.liveCourse.findMany({
      where: { id: { in: ownedIds }, status: true },
      select: { id: true, name: true, image: true, scheduleFolders: true },
    }),
    getDaysLeftMap(customerId, ownedIds),
  ]);
  const liveCourses = courses
    .map((c) => {
      const folders = jArr(c.scheduleFolders)
        .filter((f: any) => f.status !== false)
        .slice()
        .sort((a: any, b: any) => (a.order ?? 0) - (b.order ?? 0))
        .map((f: any) => ({
          _id: String(f._id),
          title: f.title,
          image: f.image ?? null,
          order: f.order ?? 0,
          entryCount: Array.isArray(f.entries) ? f.entries.length : 0,
        }))
        .filter((f) => f.entryCount > 0);
      const key = String(c.id);
      return {
        _id: String(c.id),
        name: c.name,
        image: c.image,
        scheduleFolders: folders,
        daysLeft: daysLeftMap.has(key) ? daysLeftMap.get(key) ?? null : null,
      };
    })
    // `totalLiveCourses` counts what is returned, so the FE's empty state fires on 0
    // instead of on courses that open nothing.
    .filter((c) => c.scheduleFolders.length > 0);
  return { liveCourses, totalLiveCourses: liveCourses.length };
};
