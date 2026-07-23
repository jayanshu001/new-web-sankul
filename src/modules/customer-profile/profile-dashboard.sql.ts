/**
 * Profile-dashboard counts — SQL helpers (the subscriptions + pastExams + saved-
 * addresses counts that were still Mongo in profile/dashboard.controller). Gated
 * with the `customer-profile` flag (already ON). folder/ebook/notification counts
 * are already SQL-branched in the controller; this completes the remaining ones.
 *
 * Drift: ws_exam_result has no inProgress/submittedAt columns (a result row IS a
 * completed attempt) → pastExams = result rows (status=true) joined to DAILY exams.
 * ws_package_course_subscription has no payment_status col → status=true gate.
 */
import { prisma } from "../../config/prisma";

export const isProfileMysql = (): boolean => true;

/** Active saved addresses for a customer. */
export const savedAddressCount = (customerId: number) =>
  prisma.customerAddress.count({ where: { userId: customerId, status: true } });

/**
 * Deduped active-subscription counts matching the My Subscriptions screen:
 * course (course+package+live-course, deduped by target id), test_series, ebook.
 *
 * The `course` tab of /client/my-subscriptions merges recorded course/package
 * cards with LIVE-course cards, so this count must span the same four tables or
 * the profile badge silently under-reports every live-course purchase.
 * Live-course entitlement additionally requires payment_status = "verified"
 * (the row is created at ORDER time as pending) and may be LIFETIME (end_at
 * NULL) — mirrors client-my-subscriptions.repository.activeLiveCourseSubs.
 */
export const countActiveSubscriptions = async (customerId: number, now: Date) => {
  const [cpRows, lcRows, tsRows, ebRows] = await Promise.all([
    prisma.packageCourseSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      select: { id: true, courseId: true, packageId: true },
    }),
    prisma.liveCourseSubscription.findMany({
      where: {
        customerId,
        status: true,
        paymentStatus: "verified",
        OR: [{ endAt: null }, { endAt: { gt: now } }],
      },
      select: { id: true, liveCourseId: true },
    }),
    prisma.testSeriesSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      select: { testSeriesId: true },
    }),
    prisma.eBookSubscription.findMany({
      where: { customerId, status: true, endAt: { gt: now } },
      select: { ebookId: true },
    }),
  ]);

  const dedup = (rows: any[], keyOf: (r: any) => string) => {
    const seen = new Set<string>();
    for (const r of rows) seen.add(keyOf(r));
    return seen.size;
  };
  // course tab = recorded course/package + live course, deduped per target.
  const course =
    dedup(cpRows, (s) =>
      s.courseId ? `c:${s.courseId}` : s.packageId ? `p:${s.packageId}` : `s:${s.id}`
    ) + dedup(lcRows, (s) => (s.liveCourseId ? `l:${s.liveCourseId}` : `ls:${s.id}`));
  const test_series = dedup(tsRows, (s) => `t:${s.testSeriesId}`);
  const ebook = dedup(ebRows, (s) => `e:${s.ebookId}`);
  return { total: course + test_series + ebook, course, test_series, ebook };
};

/** Past DAILY exams attempted (a result row = a completed attempt). */
export const pastDailyExamsCount = async (customerId: number): Promise<number> => {
  return prisma.examResult.count({
    where: { customerId, status: true, Exam: { is: { type: "daily" as any } } },
  });
};
