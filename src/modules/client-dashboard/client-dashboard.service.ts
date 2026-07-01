/**
 * Client dashboard flag + helpers. Gated behind `isMysqlModule("client-dashboard")`.
 * The heavy lifting lives in composed modules: client-trending (trending +
 * free dashboard), lecture-progress (resume hub), catalog/commerce reads. This
 * module owns the flag + small shared helpers for the 3 dashboard handlers.
 */
import { parseGoalSelection } from "../../utils/goalSelection";

export const isClientDashboardMysql = (): boolean => true;

export const parseCdId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

import { prisma } from "../../config/prisma";
import { computeDaysLeft } from "../../utils/planDuration";
import { fetchTrendingBooksOnly, fetchTrendingEbooksOnly } from "../client-trending/client-trending.service";

const RECENTLY_ADDED_LIMIT = 10;
const COURSE_CATEGORY_LIMIT = 20;
const EXAM_COUNTDOWN_LIMIT = 2;
const todayUTC = () => { const n = new Date(); return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())); };
const daysLeftFor = (examDate: Date) => Math.ceil((new Date(examDate).getTime() - todayUTC().getTime()) / 86_400_000);

/**
 * Upcoming exam countdowns for the dashboard, prioritised by the user's selected
 * goal-labels then filled with the nearest upcoming, capped at `limit`.
 *
 * The customer's `goal` JSON column is the composite selection
 * `[{ goalId, labelIds }]`; the selected label ids (across all chosen goals) are
 * matched against exam countdowns. A countdown tagged with `goalLabelId` in that set is
 * shown first (ordered by examDate); if fewer than `limit` match (or the user
 * has no goal), the remainder are filled with the nearest upcoming countdowns
 * (excluding the already-picked ones). Falls back to pure nearest-upcoming when
 * there are no goal matches — identical to the previous behaviour.
 */
export const fetchPrioritizedCountdowns = async (customerId: number | null, limit: number) => {
  const baseWhere = { status: true, examDate: { gte: todayUTC() } };

  // Selected goal-label ids from the customer's composite goal selection.
  let selectedLabelIds: number[] = [];
  if (customerId) {
    const c = await prisma.customer.findUnique({ where: { id: customerId }, select: { goal: true } });
    selectedLabelIds = [...new Set(parseGoalSelection(c?.goal).flatMap((s) => s.labelIds))];
  }

  // Goal-matched first (by examDate asc).
  let matched: Awaited<ReturnType<typeof prisma.examCountdown.findMany>> = [];
  if (selectedLabelIds.length) {
    matched = await prisma.examCountdown.findMany({
      where: { ...baseWhere, goalLabelId: { in: selectedLabelIds } },
      orderBy: { examDate: "asc" },
      take: limit,
    });
  }
  if (matched.length >= limit) return matched.slice(0, limit);

  // Fill the remainder with the nearest upcoming, excluding the already-picked.
  const pickedIds = matched.map((m) => m.id);
  const fillers = await prisma.examCountdown.findMany({
    where: { ...baseWhere, id: { notIn: pickedIds.length ? pickedIds : [0] } },
    orderBy: { examDate: "asc" },
    take: limit - matched.length,
  });
  return [...matched, ...fillers];
};

/** Per-customer active endAt for a set of course ids + package ids (longest wins; null=lifetime). */
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

/** getDashboard (home) sections on SQL. */
export const buildHomeDashboard = async (customerId: number | null) => {
  const now = new Date();
  const [banners, recentPackages, courses, trendingBooks, trendingEbooks, testimonials, courseCategories, examCountdownsRaw, dailyTest, unreadNotifications] = await Promise.all([
    prisma.bannerSlider.findMany({ orderBy: { orderBy: "asc" } }),
    prisma.package.findMany({ where: { active: true }, orderBy: { created_at: "desc" }, take: RECENTLY_ADDED_LIMIT, include: { packageType: { select: { id: true, name: true } } } }),
    prisma.course.findMany({ where: { status: true }, orderBy: { createdAt: "desc" } }),
    fetchTrendingBooksOnly({ type: "paid" }),
    fetchTrendingEbooksOnly({ type: "paid" }),
    prisma.testimonial.findMany({ orderBy: { rating: "desc" } }),
    prisma.courseSubjectCategory.findMany({ where: { status: true }, orderBy: { id: "asc" }, take: COURSE_CATEGORY_LIMIT }),
    fetchPrioritizedCountdowns(customerId, EXAM_COUNTDOWN_LIMIT),
    prisma.exam.findFirst({ where: { type: "daily" as any, status: true, startAt: { lte: now }, endAt: { gte: now } }, orderBy: { startAt: "desc" } }),
    customerId ? prisma.notification.count({ where: { isRead: false, OR: [{ customerId }, { broadcast: true }] } }).catch(() => 0) : 0,
  ]);

  // exam countdown categories (manual join)
  const ecCatIds = [...new Set(examCountdownsRaw.map((d) => d.categoryId).filter((n): n is number => n != null))];
  const ecCats = ecCatIds.length ? await prisma.examCountdownCategory.findMany({ where: { id: { in: ecCatIds } }, select: { id: true, name: true, colorHex: true } }) : [];
  const ecCatById = new Map(ecCats.map((c) => [c.id, c]));
  const examCountdowns = examCountdownsRaw.map((d) => ({ _id: String(d.id), title: d.title, examDate: d.examDate, daysLeft: daysLeftFor(d.examDate), category: d.categoryId && ecCatById.get(d.categoryId) ? { _id: String(d.categoryId), name: ecCatById.get(d.categoryId)!.name, colorHex: ecCatById.get(d.categoryId)!.colorHex } : null }));

  // course-category counts
  const catIds = courseCategories.map((c) => c.id);
  const catCounts = catIds.length ? await prisma.course.groupBy({ by: ["courseSubjectCategoryId"], where: { status: true, courseSubjectCategoryId: { in: catIds } }, _count: { _all: true } }) : [];
  const countByCat = new Map((catCounts as any[]).map((r) => [r.courseSubjectCategoryId, r._count._all]));
  const courseCategoriesData = courseCategories.map((c) => ({ ...c, _id: String(c.id), courseCount: countByCat.get(c.id) ?? 0 }));

  // course + package plans
  const courseIds = courses.map((c) => c.id);
  const packageIds = recentPackages.map((p) => p.id);
  const [coursePlans, { courseDaysLeft, packageDaysLeft }] = await Promise.all([
    courseIds.length ? prisma.packageCourseEbookPrice.findMany({ where: { courseId: { in: courseIds }, status: true }, orderBy: { duration: "asc" } }) : [],
    resolveOwnedEndAt(customerId, courseIds, packageIds),
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
  const recentlyAdded = recentPackages.map((p: any) => ({ ...p, _id: String(p.id), isPaid: true, isPurchased: packageDaysLeft.has(p.id), daysLeft: packageDaysLeft.get(p.id) ?? null }));

  // trending decoration (ownership)
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
  const trendingBookData = trendingBooks.items.map((b: any) => ({ ...b, isPaid: (b.price ?? 0) > 0, isPurchased: ownedBookSet.has(Number(b._id)), daysLeft: null }));
  const trendingEbookData = trendingEbooks.items.map((e: any) => { const endAt = ebookEndAt.get(Number(e._id)) ?? null; return { ...e, isPaid: !e.isFree, isPurchased: !!endAt, daysLeft: endAt ? computeDaysLeft(endAt, now) : null }; });

  // daily test attempt state
  let dailyTestSection: any = null;
  if (dailyTest) {
    let isAttempt = false; let lastResult: any = null;
    if (customerId) {
      const last = await prisma.examResult.findFirst({ where: { customerId, examId: dailyTest.id, status: true }, orderBy: { id: "desc" }, select: { id: true, attempt: true, score: true, timing: true, created_at: true } });
      if (last) { isAttempt = true; lastResult = { _id: String(last.id), attemptNumber: last.attempt, score: Number(last.score), timing: last.timing, submittedAt: last.created_at }; }
    }
    dailyTestSection = { ...dailyTest, _id: String(dailyTest.id), isAttempt, lastResult };
  }

  const dashboard: Array<{ title: string; type: string; data: unknown }> = [];
  if (banners.length) dashboard.push({ title: "Banner", type: "banner", data: banners });
  if (examCountdowns.length) dashboard.push({ title: "Exam Countdown", type: "exam-countdown", data: examCountdowns });
  if (dailyTestSection) dashboard.push({ title: "Daily Test", type: "daily-test", data: dailyTestSection });
  if (recentlyAdded.length) dashboard.push({ title: "Recently Added", type: "package", data: recentlyAdded });
  if (coursesWithPlans.length) dashboard.push({ title: "Course Subjects", type: "course", data: coursesWithPlans });
  if (courseCategoriesData.length) dashboard.push({ title: "Course Categories", type: "courseCategory", data: courseCategoriesData });
  if (trendingBookData.length) dashboard.push({ title: "Trending Books", type: "trending-book", data: trendingBookData });
  if (trendingEbookData.length) dashboard.push({ title: "Trending Ebooks", type: "trending-ebook", data: trendingEbookData });

  return { unreadNotifications, dashboard, testimonial: testimonials };
};
