import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-subscription MySQL branch (Wave 7).
 * Read + report aggregation over ALREADY-MIGRATED tables — no new tables:
 *  - course/package subs → ws_package_course_subscription (+ course/package/type/customer/plan)
 *  - ebook subs          → ws_ebook_subscription (+ ebook/customer)
 *  - reports             → groupBy/count/sum over subs + ws_book_order + ws_ebook_order
 *
 * ⚠ Drift: ws_package_course_subscription has NO payment_status / paid_amount /
 * razorpay / target_package_id columns. SQL package_id = the real package
 * (pcb_id = the plan); amount = paid amount; remarks = remark; payment_type ~
 * paymentMethod. The 3 subscription WRITES + the 2 address handlers stay Mongo
 * (write Mongo-only fields / CustomerAddress populate). Reads/reports only here.
 */
export interface CourseSubFilter {
  customerId?: number; courseId?: number; packageId?: number; status?: boolean;
  fromDate?: Date; toDate?: Date; type?: "course" | "package";
  customerIdsIn?: number[]; courseIdsIn?: number[]; packageIdsIn?: number[];
}

export const adminSubscriptionRepository = {
  // ── course/package subscription list + detail ──────────────────────────────
  listCourseSubs: (opts: CourseSubFilter & { sortBy: string; sortDir: "asc" | "desc"; skip: number; take: number }) =>
    prisma.packageCourseSubscription.findMany({
      where: buildSubWhere(opts),
      orderBy: { [subSortCol(opts.sortBy)]: opts.sortDir },
      skip: opts.skip, take: opts.take,
    }),
  countCourseSubs: (opts: CourseSubFilter) =>
    prisma.packageCourseSubscription.count({ where: buildSubWhere(opts) }),
  findCourseSubById: (id: number) => prisma.packageCourseSubscription.findUnique({ where: { id } }),

  // ── write (admin manual grant) ──────────────────────────────────────────────
  // Full plan row for create-time validation + pricing/duration.
  findPlanById: (id: number) =>
    prisma.packageCourseEbookPrice.findUnique({
      where: { id },
      select: { id: true, courseId: true, packageId: true, duration: true, price: true, withMaterial: true, materialPrice: true, status: true },
    }),
  // Latest active subscription for a customer's course/package target (upsert-extend).
  findActiveSubForTarget: (opts: { customerId: number; courseId: number | null; packageId: number | null }) => {
    const where: Prisma.PackageCourseSubscriptionWhereInput = { customerId: opts.customerId, status: true };
    if (opts.courseId) where.courseId = opts.courseId;
    else if (opts.packageId) { where.courseId = null; where.packageId = opts.packageId; }
    return prisma.packageCourseSubscription.findFirst({ where, orderBy: { endAt: "desc" } });
  },
  createSub: (d: {
    customerId: number; courseId: number | null; packageId: number | null; planId: number;
    shippingId: number | null; startAt: Date; endAt: Date; status: boolean; amount: number;
    courseAmount: number | null; materialAmount: number | null;
    payment_type: "backend" | "online"; remarks: string | null; now: Date;
  }) =>
    prisma.packageCourseSubscription.create({
      data: {
        customerId: d.customerId,
        courseId: d.courseId,
        packageId: d.packageId,
        planId: d.planId,
        shippingId: d.shippingId,
        startAt: d.startAt,
        endAt: d.endAt,
        status: d.status,
        amount: d.amount,
        courseAmount: d.courseAmount,
        materialAmount: d.materialAmount,
        payment_type: d.payment_type,
        remarks: d.remarks,
        createdAt: d.now,
        updatedAt: d.now,
      },
    }),
  extendSub: (id: number, d: { endAt: Date; planId: number; amount: number; shippingId?: number | null; remarks?: string | null; now: Date }) =>
    prisma.packageCourseSubscription.update({
      where: { id },
      data: {
        endAt: d.endAt,
        planId: d.planId,
        amount: d.amount,
        ...(d.shippingId !== undefined ? { shippingId: d.shippingId } : {}),
        ...(d.remarks !== undefined ? { remarks: d.remarks } : {}),
        updatedAt: d.now,
      },
    }),

  // ── hydration ────────────────────────────────────────────────────────────────
  customersByIds: (ids: number[]) =>
    ids.length ? prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } }) : Promise.resolve([]),
  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, duration: true, price: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, author: true } }) : Promise.resolve([]),

  // ── search-id resolvers (cross-table search) ────────────────────────────────
  customerIdsByText: async (q: string) => (await prisma.customer.findMany({ where: { OR: [{ fullName: { contains: q } }, { phoneNumber: { contains: q } }] }, select: { id: true } })).map((r) => r.id),
  courseIdsByText: async (q: string) => (await prisma.course.findMany({ where: { name: { contains: q } }, select: { id: true } })).map((r) => r.id),
  packageIdsByText: async (q: string) => (await prisma.package.findMany({ where: { name: { contains: q } }, select: { id: true } })).map((r) => r.id),

  // ── plans-for-target ─────────────────────────────────────────────────────────
  plansForTarget: (opts: { courseId?: number; packageId?: number }) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { status: true, ...(opts.courseId ? { courseId: opts.courseId } : {}), ...(opts.packageId ? { packageId: opts.packageId } : {}) },
      orderBy: { duration: "asc" },
    }),

  // ── ebook subs ─────────────────────────────────────────────────────────────────
  listEbookSubs: (opts: { customerId?: number; ebookId?: number; status?: boolean; fromDate?: Date; toDate?: Date; skip: number; take: number }) =>
    prisma.eBookSubscription.findMany({ where: buildEbookSubWhere(opts), orderBy: { id: "desc" }, skip: opts.skip, take: opts.take }),
  countEbookSubs: (opts: { customerId?: number; ebookId?: number; status?: boolean; fromDate?: Date; toDate?: Date }) =>
    prisma.eBookSubscription.count({ where: buildEbookSubWhere(opts) }),

  // ── reports ────────────────────────────────────────────────────────────────────
  countSubs: (where: Prisma.PackageCourseSubscriptionWhereInput) => prisma.packageCourseSubscription.count({ where }),
  countEbookSubsRaw: (where: Prisma.EBookSubscriptionWhereInput) => prisma.eBookSubscription.count({ where }),
  ebookOrderRevenue: (where: Prisma.EBookOrderWhereInput) => prisma.eBookOrder.aggregate({ where, _sum: { orderPrice: true }, _count: { _all: true } }),
  bookOrderRevenue: (where: Prisma.BookOrderWhereInput) => prisma.bookOrder.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
  countBookOrders: (where: Prisma.BookOrderWhereInput) => prisma.bookOrder.count({ where }),
  subsByCourse: (where: Prisma.PackageCourseSubscriptionWhereInput) =>
    prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where, _count: { _all: true } }),
  subsByCourseActive: (where: Prisma.PackageCourseSubscriptionWhereInput) =>
    prisma.packageCourseSubscription.groupBy({ by: ["courseId"], where: { ...where, status: true }, _count: { _all: true } }),
  ebookSubsByEbook: (where: Prisma.EBookSubscriptionWhereInput) =>
    prisma.eBookSubscription.groupBy({ by: ["ebookId"], where, _count: { _all: true }, _sum: { price: true } }),
  ebookSubsByEbookActive: (where: Prisma.EBookSubscriptionWhereInput) =>
    prisma.eBookSubscription.groupBy({ by: ["ebookId"], where: { ...where, status: true }, _count: { _all: true } }),
  bookOrdersByStatus: (where: Prisma.BookOrderWhereInput) =>
    prisma.bookOrder.groupBy({ by: ["status"], where, _count: { _all: true }, _sum: { amount: true } }),
};

function subSortCol(sortBy: string): string {
  if (sortBy === "startAt" || sortBy === "start_at") return "startAt";
  if (sortBy === "endAt" || sortBy === "end_at") return "endAt";
  if (sortBy === "amount") return "amount";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updatedAt";
  return "createdAt";
}

function buildSubWhere(opts: CourseSubFilter): Prisma.PackageCourseSubscriptionWhereInput {
  const where: Prisma.PackageCourseSubscriptionWhereInput = {};
  if (opts.customerId !== undefined) where.customerId = opts.customerId;
  if (opts.courseId !== undefined) where.courseId = opts.courseId;
  if (opts.packageId !== undefined) where.packageId = opts.packageId;
  if (opts.status !== undefined) where.status = opts.status;
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  // type: course = courseId>0; package = courseId null/0 AND package_id>0
  if (opts.type === "course") where.courseId = { gt: 0 };
  else if (opts.type === "package") { where.courseId = null; where.packageId = { gt: 0 }; }
  // cross-table search OR (any of customer/course/package id matches)
  const or: Prisma.PackageCourseSubscriptionWhereInput[] = [];
  if (opts.customerIdsIn?.length) or.push({ customerId: { in: opts.customerIdsIn } });
  if (opts.courseIdsIn?.length) or.push({ courseId: { in: opts.courseIdsIn } });
  if (opts.packageIdsIn?.length) or.push({ packageId: { in: opts.packageIdsIn } });
  if (or.length) where.OR = or;
  return where;
}

function buildEbookSubWhere(opts: { customerId?: number; ebookId?: number; status?: boolean; fromDate?: Date; toDate?: Date }): Prisma.EBookSubscriptionWhereInput {
  const where: Prisma.EBookSubscriptionWhereInput = {};
  if (opts.customerId !== undefined) where.customerId = opts.customerId;
  if (opts.ebookId !== undefined) where.ebookId = opts.ebookId;
  if (opts.status !== undefined) where.status = opts.status;
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  return where;
}
