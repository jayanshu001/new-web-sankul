/**
 * Profile-dashboard counts — SQL helpers (the subscriptions + pastExams + saved-
 * addresses counts that were still Mongo in profile/dashboard.controller). Gated
 * with the `customer-profile` flag (already ON). folder/ebook/notification counts
 * are already SQL-branched in the controller; this completes the remaining ones.
 *
 * ws_package_course_subscription has no payment_status col → status=true gate.
 *
 * NOTE: an earlier version of this header claimed ws_exam_result has no
 * inProgress/submittedAt columns and that a result row IS a completed attempt.
 * That is wrong — the model maps `qresult_in_progress` / `qresult_submitted_at`,
 * and `pastExamsCount` now gates on them.
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

/**
 * Past exams attempted by this customer — DAILY **and** SUBJECT combined.
 *
 * "Past" means a finished attempt: `inProgress = false` AND `submittedAt` set.
 * A result row is NOT automatically a completed attempt (rows exist with
 * `submittedAt = NULL`), contrary to the stale note this file used to carry —
 * `ExamResult` does map `qresult_in_progress` / `qresult_submitted_at`.
 *
 * The type filter is spelled out as `in [daily, subject]` rather than dropped
 * entirely, so that (a) result rows whose exam was deleted don't silently count
 * as "past exams" the UI can't name, and (b) if a third ExamType is ever added
 * someone has to consciously decide whether it belongs in this badge.
 * `ExamType` is currently exactly { daily, subject }.
 */
export const pastExamsCount = async (customerId: number): Promise<number> => {
  return prisma.examResult.count({
    where: {
      customerId,
      status: true,
      inProgress: false,
      submittedAt: { not: null },
      Exam: { is: { type: { in: ["daily", "subject"] as any } } },
    },
  });
};
