// Customer profile dashboard: badge counts for addresses, subscriptions and past exams.
import { prisma } from "../../config/prisma";

export const savedAddressCount = (customerId: number) =>
  prisma.customerAddress.count({ where: { userId: customerId, status: true } });

/**
 * Deduped active-subscription counts matching the My Subscriptions screen. Its
 * `course` tab merges course/package cards with live-course cards, so this must
 * span all four tables or the badge under-reports live-course purchases. The
 * package table has no payment-status column (`status` is the gate); live-course
 * entitlement may be lifetime (end_at NULL).
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
        // A live-course subscription row exists only for a paid order (payment lives
        // on ws_live_course_order), so `status` is the entitlement gate.
        status: true,
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
  const course =
    dedup(cpRows, (s) =>
      s.courseId ? `c:${s.courseId}` : s.packageId ? `p:${s.packageId}` : `s:${s.id}`
    ) + dedup(lcRows, (s) => (s.liveCourseId ? `l:${s.liveCourseId}` : `ls:${s.id}`));
  const test_series = dedup(tsRows, (s) => `t:${s.testSeriesId}`);
  const ebook = dedup(ebRows, (s) => `e:${s.ebookId}`);
  return { total: course + test_series + ebook, course, test_series, ebook };
};

/**
 * Finished daily + subject attempts. A result row is not automatically a
 * completed attempt (rows exist with `submittedAt = NULL`).
 *
 * The type filter is explicit so results of deleted exams don't count, and a
 * future ExamType must be consciously added to this badge.
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
