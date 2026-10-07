// Home dashboard: assembles the client home screen sections.
import { parseGoalSelection } from "../../utils/goalSelection";

export const parseCdId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import { fetchTrendingBooksOnly, fetchTrendingEbooksOnly } from "../client-trending/client-trending.service";
import { listRecentlyAdded } from "../client-recently-added/client-recently-added.service";
// Reused so the dashboard badge matches GET /client/notifications/count (excludes
// read and dismissed notifications).
import { unreadCount as notificationUnreadCount } from "../client-notification/client-notification.service";

const COURSE_CATEGORY_LIMIT = 20;
// Safety ceiling only; the table holds a handful of rows.
const BANNER_LIMIT = 50;
const EXAM_COUNTDOWN_LIMIT = 2;
// Every non-banner section is trimmed to its latest N items.
const DASHBOARD_SECTION_LIMIT = 5;
const todayUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
const daysLeftFor = (examDate: Date) => Math.ceil((new Date(examDate).getTime() - todayUTC().getTime()) / 86_400_000);

/**
 * Countdowns tagged with one of the customer's selected goal-label ids come first
 * (by examDate); the remainder up to `limit` is filled with the nearest upcoming ones.
 */
export const fetchPrioritizedCountdowns = async (customerId: number | null, limit: number) => {
  const baseWhere = { status: true, examDate: { gte: todayUTC() } };

  let selectedLabelIds: number[] = [];
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { goal: true } });
    selectedLabelIds = [...new Set(parseGoalSelection(c?.goal).flatMap((s) => s.labelIds))];
  }

  let matched: Awaited<ReturnType<typeof prisma.examCountdown.findMany>> = [];
  if (selectedLabelIds.length) {
    matched = await prisma.examCountdown.findMany({
      where: { ...baseWhere, goalLabelId: { in: selectedLabelIds } },
      orderBy: { examDate: "asc" },
      take: limit,
    });
  }
  if (matched.length >= limit) return matched.slice(0, limit);

  const pickedIds = matched.map((m) => m.id);
  const fillers = await prisma.examCountdown.findMany({
    where: { ...baseWhere, id: { notIn: pickedIds.length ? pickedIds : [0] } },
    orderBy: { examDate: "asc" },
    take: limit - matched.length,
  });
  return [...matched, ...fillers];
};

/** Per-customer daysLeft for course and package ids: longest wins, null (lifetime) beats any date. */
const resolveOwnedEndAt = async (customerId: number | null, courseIds: number[], packageIds: number[]) => {
  const courseDaysLeft = new Map<number, number | null>();
  const packageDaysLeft = new Map<number, number | null>();
  if (!customerId) return { courseDaysLeft, packageDaysLeft };
  const now = new Date();
  const subs = await prisma.packageCourseSubscription.findMany({
    where: { customerId, status: true, OR: [{ endAt: null }, { endAt: { gt: now } }], AND: [{ OR: [{ courseId: { in: courseIds.length ? courseIds : [0] } }, { packageId: { in: packageIds.length ? packageIds : [0] } }] }] },
    select: { courseId: true, packageId: true, endAt: true },
  });
  const upsert = (map: Map<number, number | null>, key: number | null, endAt: Date | null) => {
    if (key == null) return;
    const dl = endAt == null ? null : computeDaysLeft(endAt, now);
    if (!map.has(key)) { map.set(key, dl); return; }
    const prev = map.get(key)!;
    if (prev === null || dl === null) { map.set(key, null); return; } // lifetime wins
    if (dl > prev) map.set(key, dl);
  };
  for (const s of subs) { upsert(courseDaysLeft, s.courseId, s.endAt ?? null); upsert(packageDaysLeft, s.packageId, s.endAt ?? null); }
  return { courseDaysLeft, packageDaysLeft };
};

// Guests (null customerId) get the same keys without owned/purchase state.
export const buildHomeDashboard = async (customerId: number | null) => {
  const now = new Date();
  const [banners, recentlyAddedFeed, courses, trendingBooks, trendingEbooks, testimonials, courseCategories, examCountdownsRaw, dailyTest, unreadNotifications] = await Promise.all([
    // ws_banner_slider has no status column; the cap only guards against an unbounded read.
    prisma.bannerSlider.findMany({ orderBy: [{ orderBy: "asc" }, { created_at: "asc" }], take: BANNER_LIMIT }),
    // Capped here; the full paginated feed lives at GET /client/recently-added.
    listRecentlyAdded(customerId, { page: 1, limit: DASHBOARD_SECTION_LIMIT }),
    prisma.course.findMany({ where: { status: true }, orderBy: [{ ordered: "asc" }, { createdAt: "asc" }], take: DASHBOARD_SECTION_LIMIT }),
    fetchTrendingBooksOnly({ type: "paid", customerId }),
    fetchTrendingEbooksOnly({ type: "paid" }),
    prisma.testimonial.findMany({ orderBy: { rating: "desc" }, take: DASHBOARD_SECTION_LIMIT }),
    prisma.courseSubjectCategory.findMany({ where: { status: true }, orderBy: [{ order: "asc" }, { createdAt: "asc" }], take: COURSE_CATEGORY_LIMIT }),
    fetchPrioritizedCountdowns(customerId, EXAM_COUNTDOWN_LIMIT),
    // `endAt: null` is open-ended and still live.
    prisma.exam.findFirst({ where: { type: "daily" as any, status: true, startAt: { lte: now }, OR: [{ endAt: null }, { endAt: { gte: now } }] }, orderBy: { startAt: "desc" } }),
    customerId ? notificationUnreadCount(customerId).catch(() => 0) : 0,
  ]);

  const ecCatIds = [...new Set(examCountdownsRaw.map((d) => d.categoryId).filter((n): n is number => n != null))];
  const ecCats = ecCatIds.length ? await prisma.examCountdownCategory.findMany({ where: { id: { in: ecCatIds } }, select: { id: true, name: true, colorHex: true } }) : [];
  const ecCatById = new Map(ecCats.map((c) => [c.id, c]));
  const examCountdowns = examCountdownsRaw.map((d) => ({ _id: String(d.id), title: d.title, examDate: d.examDate, daysLeft: daysLeftFor(d.examDate), category: d.categoryId && ecCatById.get(d.categoryId) ? { _id: String(d.categoryId), name: ecCatById.get(d.categoryId)!.name, colorHex: ecCatById.get(d.categoryId)!.colorHex } : null }));

  const catIds = courseCategories.map((c) => c.id);
  const catCounts = catIds.length ? await prisma.course.groupBy({ by: ["courseSubjectCategoryId"], where: { status: true, courseSubjectCategoryId: { in: catIds } }, _count: { _all: true } }) : [];
  const countByCat = new Map((catCounts as any[]).map((r) => [r.courseSubjectCategoryId, r._count._all]));
  const courseCategoriesData = courseCategories.map((c) => ({ ...c, _id: String(c.id), courseCount: countByCat.get(c.id) ?? 0 }));

  const courseIds = courses.map((c) => c.id);
  const [coursePlans, { courseDaysLeft }] = await Promise.all([
    courseIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { courseId: { in: courseIds }, status: true }, orderBy: { duration: "asc" } }) : [],
    resolveOwnedEndAt(customerId, courseIds, []),
  ]);
  const plansByCourse = new Map<number, { withMaterial: any[]; withoutMaterial: any[] }>();
  for (const p of coursePlans) { if (p.courseId == null) continue; const b = plansByCourse.get(p.courseId) ?? plansByCourse.set(p.courseId, { withMaterial: [], withoutMaterial: [] }).get(p.courseId)!; (p.withMaterial ? b.withMaterial : b.withoutMaterial).push(p); }

  const coursesWithPlans = courses.map((c: any) => ({
    ...c, _id: String(c.id),
    plans: plansByCourse.get(c.id) ?? { withMaterial: [], withoutMaterial: [] },
    isPaid: c.purchase != null ? c.purchase !== "no" : true,
    isPurchased: courseDaysLeft.has(c.id),
    daysLeft: courseDaysLeft.get(c.id) ?? null,
  }));
  const recentlyAdded = recentlyAddedFeed.data;

  const bookIds = trendingBooks.items.map((b: any) => Number(b._id));
  const ebookIds = trendingEbooks.items.map((e: any) => Number(e._id));
  const ownedBookSet = new Set<number>();
  const ebookEndAt = new Map<number, Date>();
  if (customerId) {
    if (bookIds.length) {
      const orders = await prisma.bookOrder.findMany({ where: { userId: customerId, status: { in: ["verified", "shipped", "delivered"] } }, select: { id: true } });
      if (orders.length) { const items = await prisma.bookOrderItem.findMany({ where: { order_id: { in: orders.map((o) => String(o.id)) }, bookId: { in: bookIds } }, select: { bookId: true } }); for (const it of items) if (it.bookId != null) ownedBookSet.add(it.bookId); }
    }
    if (ebookIds.length) {
      const subs = await prisma.eBookSubscription.findMany({ where: { customerId, ebookId: { in: ebookIds }, status: true, endAt: { gt: now } }, select: { ebookId: true, endAt: true } });
      for (const s of subs) { if (s.ebookId == null || s.endAt == null) continue; const prev = ebookEndAt.get(s.ebookId); if (!prev || s.endAt > prev) ebookEndAt.set(s.ebookId, s.endAt); }
    }
  }
  // `orderBy` is an internal sort key on the trending DTO — strip before emitting.
  const trendingBookData = trendingBooks.items.map(({ orderBy: _o, ...b }: any) => ({ ...b, isPaid: (b.price ?? 0) > 0, isPurchased: ownedBookSet.has(Number(b._id)), daysLeft: null }));
  const trendingEbookData = trendingEbooks.items.map(({ orderBy: _o, ...e }: any) => { const endAt = ebookEndAt.get(Number(e._id)) ?? null; return { ...e, isPaid: !e.isFree, isPurchased: !!endAt, daysLeft: endAt ? computeDaysLeft(endAt, now) : null }; });

  let dailyTestSection: any = null;
  if (dailyTest) {
    let isAttempt = false; let lastResult: any = null;
    if (customerId) {
      const last = await prisma.examResult.findFirst({ where: { customerId, examId: dailyTest.id, status: true }, orderBy: { id: "desc" }, select: { id: true, attempt: true, score: true, timing: true, created_at: true } });
      if (last) { isAttempt = true; lastResult = { _id: String(last.id), attemptNumber: last.attempt, score: Number(last.score), timing: last.timing, submittedAt: last.created_at }; }
    }
    dailyTestSection = { ...dailyTest, _id: String(dailyTest.id), isAttempt, lastResult };
  }

  // Every section is always present (empty `data` when there is nothing) so the shape stays stable.
  const dashboard: Array<{ title: string; type: string; data: unknown }> = [
    { title: "Banner", type: "banner", data: banners },
    { title: "Exam Countdown", type: "exam-countdown", data: examCountdowns },
    { title: "Daily Test", type: "daily-test", data: dailyTestSection ? [dailyTestSection] : [] },
    { title: "Recently Added", type: "recently-added", data: recentlyAdded },
    { title: "Course Subjects", type: "course", data: coursesWithPlans },
    { title: "Course Categories", type: "courseCategory", data: courseCategoriesData },
    { title: "Trending Books", type: "trending-book", data: trendingBookData },
    { title: "Trending Ebooks", type: "trending-ebook", data: trendingEbookData },
  ];

  // Cap every section except the banner carousel; each is already ordered most-recent first.
  const cappedDashboard = dashboard.map((section) =>
    section.type === "banner" || !Array.isArray(section.data)
      ? section
      : { ...section, data: section.data.slice(0, DASHBOARD_SECTION_LIMIT) }
  );

  return { unreadNotifications, dashboard: cappedDashboard, testimonial: testimonials };
};
