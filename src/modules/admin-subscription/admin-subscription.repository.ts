import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { andWhere } from "../../utils/reportFilters";

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
  paymentType?: "online" | "backend"; hasMaterial?: boolean;
  fromDate?: Date; toDate?: Date; type?: "course" | "package";
  // independent ranges on the subscription's own start/end columns (createdAt is fromDate/toDate)
  startFrom?: Date; startTo?: Date; endFrom?: Date; endTo?: Date;
  customerIdsIn?: number[]; courseIdsIn?: number[]; packageIdsIn?: number[];
}

export const adminSubscriptionRepository = {
  // ── course/package subscription list + detail ──────────────────────────────
  // Reports contract: the caller composes the final `where` (base filters AND a
  // normalized-status fragment) with reportFilters.andWhere, then passes it here.
  buildCourseSubBaseWhere: (opts: CourseSubFilter): Prisma.PackageCourseSubscriptionWhereInput => buildSubWhere(opts),
  listCourseSubsByWhere: (where: Prisma.PackageCourseSubscriptionWhereInput, sortBy: string, sortDir: "asc" | "desc", skip: number, take: number) =>
    prisma.packageCourseSubscription.findMany({ where, orderBy: { [subSortCol(sortBy)]: sortDir }, skip, take }),
  aggCourseSubs: (where: Prisma.PackageCourseSubscriptionWhereInput) =>
    prisma.packageCourseSubscription.aggregate({ where, _sum: { amount: true }, _count: { _all: true } }),
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
  patchSub: (
    id: number,
    d: {
      startAt?: Date; endAt?: Date; status?: boolean;
      shippingId?: number | null; trackingId?: bigint | null; remarks?: string; now: Date;
    }
  ) =>
    prisma.packageCourseSubscription.update({
      where: { id },
      data: {
        ...(d.startAt !== undefined ? { startAt: d.startAt } : {}),
        ...(d.endAt !== undefined ? { endAt: d.endAt } : {}),
        ...(d.status !== undefined ? { status: d.status } : {}),
        ...(d.shippingId !== undefined ? { shippingId: d.shippingId } : {}),
        ...(d.trackingId !== undefined ? { trackingId: d.trackingId } : {}),
        ...(d.remarks !== undefined ? { remarks: d.remarks } : {}),
        updatedAt: d.now,
      },
    }),
  deleteSub: (id: number) => prisma.packageCourseSubscription.delete({ where: { id } }),

  // ── hydration ────────────────────────────────────────────────────────────────
  customersByIds: (ids: number[]) =>
    ids.length ? prisma.customer.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } }) : Promise.resolve([]),
  coursesByIds: (ids: number[]) =>
    ids.length ? prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true, courseEducatorId: true } }) : Promise.resolve([]),
  packagesByIds: (ids: number[]) =>
    ids.length ? prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } }) : Promise.resolve([]),
  plansByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseEbookPrice.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, duration: true, price: true } }) : Promise.resolve([]),
  ebooksByIds: (ids: number[]) =>
    ids.length ? prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, author: true } }) : Promise.resolve([]),
  // Report-column hydration (merged Subscription Report):
  //  order → razorpay/bank ids, ws coin, promocode json snapshot
  ordersByIds: (ids: number[]) =>
    ids.length ? prisma.packageCourseOrder.findMany({ where: { id: { in: ids } }, select: { id: true, gatewayOrderId: true, gatewayPaymentId: true, bankTransactionId: true, wsCoin: true, promocode: true } }) : Promise.resolve([]),
  //  shipping → Address / City / Pincode
  shippingsByIds: (ids: number[]) =>
    ids.length ? prisma.customerShipping.findMany({ where: { id: { in: ids } }, select: { id: true, address: true, address_2: true, city: true, pincode: true, alternate_phone: true } }) : Promise.resolve([]),
  //  promoter → Promoter name
  promotersByIds: (ids: number[]) =>
    ids.length ? prisma.promoter.findMany({ where: { id: { in: ids } }, select: { id: true, full_name: true } }) : Promise.resolve([]),
  //  course educator → Educator name
  educatorsByIds: (ids: number[]) =>
    ids.length ? prisma.courseEducator.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } }) : Promise.resolve([]),
  //  created_by → admin/staff name (Activated By); ws_users PK is BigInt.
  adminUsersByIds: (ids: number[]) =>
    ids.length ? prisma.adminUser.findMany({ where: { id: { in: ids.map((i) => BigInt(i)) } }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve([]),
  //  promocode code string → current ws_promocode record id (for the report link).
  //  The order's `promocode` column is a purchase-time JSON snapshot with no live
  //  FK, so resolve the id by the code string (indexed: idx_ws_promocode_code).
  promocodesByCodes: (codes: string[]) =>
    codes.length ? prisma.promocode.findMany({ where: { promocode: { in: codes } }, select: { id: true, promocode: true } }) : Promise.resolve([]),

  // ── search-id resolvers (cross-table search) ────────────────────────────────
  customerIdsByText: async (q: string) => (await prisma.customer.findMany({ where: { OR: [{ fullName: { contains: q } }, { phoneNumber: { contains: q } }, { emailAddress: { contains: q } }] }, select: { id: true } })).map((r) => r.id),
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

// Base where for the reports list: everything EXCEPT the normalized status
// (status is applied by the service via reportFilters.statusWhere + andWhere,
// because "active" carries its own OR that must not collide with the search OR).
function buildSubWhere(opts: CourseSubFilter): Prisma.PackageCourseSubscriptionWhereInput {
  const where: Prisma.PackageCourseSubscriptionWhereInput = {};
  if (opts.customerId !== undefined) where.customerId = opts.customerId;
  if (opts.courseId !== undefined) where.courseId = opts.courseId;
  if (opts.packageId !== undefined) where.packageId = opts.packageId;
  if (opts.paymentType !== undefined) where.payment_type = opts.paymentType;
  // Subscription Material Report: only with-material rows. Mirrors the report
  // label's single source of truth (service rowHasMaterial): legacy rows carry a
  // pc_material_id, SQL-created grants carry only a material_amount — either counts.
  // AND-ed (not a 2nd top-level OR) so it doesn't collide with the search OR below.
  if (opts.hasMaterial) where.AND = [{ OR: [{ pcMaterialId: { gt: 0 } }, { materialAmount: { gt: 0 } }] }];
  if (opts.fromDate || opts.toDate) {
    where.createdAt = {};
    if (opts.fromDate) where.createdAt.gte = opts.fromDate;
    if (opts.toDate) where.createdAt.lte = opts.toDate;
  }
  // independent Start / End date ranges (own columns; AND with createdAt & all else)
  if (opts.startFrom || opts.startTo) {
    where.startAt = {};
    if (opts.startFrom) where.startAt.gte = opts.startFrom;
    if (opts.startTo) where.startAt.lte = opts.startTo;
  }
  if (opts.endFrom || opts.endTo) {
    where.endAt = {};
    if (opts.endFrom) where.endAt.gte = opts.endFrom;
    if (opts.endTo) where.endAt.lte = opts.endTo;
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
// re-exported combinator used by the service to AND the status fragment on.
export { andWhere };

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
