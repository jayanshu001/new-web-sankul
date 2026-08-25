import { prisma } from "../../config/prisma";
import type { Prisma, PaymentMethod } from "@prisma/client";
import { buildPrismaSearch } from "../../utils/searchFilter";

// Filters shared by list + count so `pagination.total` matches the page slice.
export type SubFilter = {
  customerId?: number;
  ebookId?: number;
  status?: boolean;
  statusFilter?: "active" | "expired" | "inactive";
  paymentMethod?: PaymentMethod;
  dateFrom?: Date;
  dateTo?: Date;
  now?: Date;
  customerIdsIn?: number[];
  ebookIdsIn?: number[];
};

/**
 * Prisma persistence for the admin-ebook MySQL branch.
 *  - ebooks       → ws_ebook
 *  - plans        → ws_package_course_ebook_price (ebook-owned rows; shared table,
 *                   same as admin-plan / commerce-price)
 *  - subscriptions→ ws_ebook_subscription (+ ws_ebook_order for the backend grant)
 *
 * ⚠ Schema-drift: ws_ebook has NO column for isTrending, the PDF-upload status
 * fields (book/demoUploadStatus/Progress), or the Mongo-only examCountdown*
 * relations. ws_ebook_order.customer_id is varchar(255) in the DB (Prisma maps
 * Int — MySQL casts transparently on read/write; verified).
 */
const OWNED = (v: number | null | undefined) => v != null && v > 0;

export const adminEbookRepository = {
  // ── ebooks ───────────────────────────────────────────────────────────────────
  list: (opts: { search?: string; author?: string; publisher?: string; language?: string; status?: boolean; skip: number; take: number }) =>
    prisma.eBook.findMany({
      where: buildEbookWhere(opts),
      // Recency is the contract on admin lists — see utils/listOrdering.
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  count: (opts: { search?: string; author?: string; publisher?: string; language?: string; status?: boolean }) =>
    prisma.eBook.count({ where: buildEbookWhere(opts) }),

  findById: (id: number) => prisma.eBook.findUnique({ where: { id } }),
  exists: (id: number) => prisma.eBook.findUnique({ where: { id }, select: { id: true } }),

  create: (data: Prisma.EBookUncheckedCreateInput) => prisma.eBook.create({ data }),
  update: (id: number, data: Prisma.EBookUncheckedUpdateInput) => prisma.eBook.update({ where: { id }, data }),
  delete: (id: number) =>
    // Cascade the ebook's plans (mirrors the Mongo deleteEbook's EbookPrice.deleteMany).
    prisma.$transaction(async (tx) => {
      await tx.packageCourseEbookPrice.deleteMany({ where: { ebookId: id } });
      await tx.eBook.delete({ where: { id } });
    }),
  setOrder: (id: number, order: number) =>
    prisma.eBook.update({ where: { id }, data: { orderby: order, updatedAt: new Date() } }),

  // ── plans (ebook-owned price rows) ─────────────────────────────────────────────
  listPlans: (ebookId: number, opts?: { activeOnly?: boolean; skip?: number; take?: number }) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { ebookId, ...(opts?.activeOnly ? { status: true } : {}) },
      orderBy: [{ price: "asc" }, { id: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),
  countPlans: (ebookId: number) =>
    prisma.packageCourseEbookPrice.count({ where: { ebookId } }),
  findPlanById: (id: number) =>
    prisma.packageCourseEbookPrice.findUnique({ where: { id }, include: { EBook: { select: { id: true, name: true } } } }),
  findPlanBare: (id: number) => prisma.packageCourseEbookPrice.findUnique({ where: { id } }),
  createPlan: (data: Prisma.PackageCourseEbookPriceUncheckedCreateInput) => prisma.packageCourseEbookPrice.create({ data }),
  updatePlan: (id: number, data: Prisma.PackageCourseEbookPriceUncheckedUpdateInput) => prisma.packageCourseEbookPrice.update({ where: { id }, data }),
  /**
   * Promo-code plan links point at ws_package_course_ebook_price.id with NO foreign
   * key, so deleting a plan without clearing them leaves rows in
   * ws_promoted_package_course_ebook aimed at an id that no longer exists — the same
   * orphan class the delete guards exist to prevent. admin-plan.deletePlan has always
   * done this; the per-module deletes did not.
   */
  deletePromotedForPlan: (planId: number) =>
    prisma.promotedPackageCourseEbook.deleteMany({ where: { planId } }),
  deletePlan: (id: number) => prisma.packageCourseEbookPrice.delete({ where: { id } }),

  // ── subscriptions ──────────────────────────────────────────────────────────────
  listSubscriptions: (opts: SubFilter & {
    sortBy: string;
    sortDir: "asc" | "desc";
    skip: number;
    take: number;
  }) =>
    prisma.eBookSubscription.findMany({
      where: buildSubWhere(opts),
      include: {
        customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        eBook: { select: { id: true, name: true, image: true, thumbnail: true, author: true } },
        eBookOrder: {
          select: { id: true, paymentMethod: true, orderPrice: true, status: true, planId: true,
            gatewayOrderId: true, gatewayPaymentId: true,
            PackageCourseEbookPrice: { select: { id: true, name: true, duration: true, price: true } } },
        },
      },
      orderBy: { [subSortCol(opts.sortBy)]: opts.sortDir },
      skip: opts.skip,
      take: opts.take,
    }),
  // Keyset page for the UNBOUNDED export: same filter + includes as listSubscriptions,
  // ordered id DESC, rows strictly older than the last id seen — no deep OFFSET, no row
  // cap, so the caller can walk the full filtered set (lakhs) in O(take) pages.
  listSubscriptionsPageKeyset: (opts: SubFilter, beforeId: number | undefined, take: number) => {
    const base = buildSubWhere(opts);
    return prisma.eBookSubscription.findMany({
      where: beforeId ? { AND: [base, { id: { lt: beforeId } }] } : base,
      include: {
        customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        eBook: { select: { id: true, name: true, image: true, thumbnail: true, author: true } },
        eBookOrder: {
          select: { id: true, paymentMethod: true, orderPrice: true, status: true, planId: true,
            gatewayOrderId: true, gatewayPaymentId: true,
            PackageCourseEbookPrice: { select: { id: true, name: true, duration: true, price: true } } },
        },
      },
      orderBy: { id: "desc" },
      take,
    });
  },
  countSubscriptions: (opts: SubFilter) =>
    prisma.eBookSubscription.count({ where: buildSubWhere(opts) }),

  findSubscriptionById: (id: number) =>
    prisma.eBookSubscription.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } },
        eBook: { select: { id: true, name: true, author: true } },
        eBookOrder: true,
      },
    }),
  findSubscriptionBare: (id: number) => prisma.eBookSubscription.findUnique({ where: { id } }),

  /**
   * The customer who owns this subscription. Read BEFORE an admin revoke so the
   * caller can flush that customer's per-user route cache — on delete the row is
   * gone afterwards, so this cannot be resolved after the fact.
   */
  findSubscriptionCustomerId: (id: number) =>
    prisma.eBookSubscription.findUnique({ where: { id }, select: { customerId: true } }),
  findOrderById: (id: number) => prisma.eBookOrder.findUnique({ where: { id } }),

  /** Backend grant: create the COMPLETE order + its subscription in one txn. */
  createBackendSubscription: (input: {
    uniqueId: string;
    customerId: number;
    ebookId: number;
    planId: number | null;
    paymentMethod: string;
    orderPrice: number;
    razorpayOrderId: string | null;
    razorpayPaymentId: string | null;
    transactionId: string | null;
    ipAddress: string | null;
    price: number;
    startAt: Date;
    endAt: Date;
    remarks: string | null;
    status: boolean;
    // Acting admin id (from the JWT) → both audit columns on the new sub row.
    actingAdminId?: number | null;
  }) =>
    prisma.$transaction(async (tx) => {
      const order = await tx.eBookOrder.create({
        data: {
          uniqueId: input.uniqueId,
          userId: input.customerId,
          orderType: "purchase",
          // ws_ebook_order.plan_id is NOT NULL — use 0 when no plan was chosen
          // (durationInDays path). Mongo stores null; 0 is the SQL sentinel.
          planId: input.planId ?? 0,
          orderPrice: input.orderPrice,
          paymentMethod: input.paymentMethod as any,
          gatewayOrderId: input.razorpayOrderId ?? "",
          gatewayPaymentId: input.razorpayPaymentId ?? null,
          bankTransactionId: input.transactionId ?? null,
          ip_address: input.ipAddress,
          status: "complete",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      const subscription = await tx.eBookSubscription.create({
        data: {
          orderId: order.id,
          customerId: input.customerId,
          ebookId: input.ebookId,
          price: input.price,
          startAt: input.startAt,
          endAt: input.endAt,
          remarks: input.remarks,
          payment_type: "backend",
          status: input.status,
          // Admin-initiated manual grant → both audit columns = the acting admin.
          created_by: input.actingAdminId ?? null,
          updated_by: input.actingAdminId ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
      return { order, subscription };
    }),

  /** Latest active subscription for a customer's ebook (Subscription Type = Extend). */
  findActiveSubscription: (customerId: number, ebookId: number, now: Date) =>
    prisma.eBookSubscription.findFirst({
      where: { customerId, ebookId, status: true, endAt: { gte: now } },
      orderBy: { endAt: "desc" },
    }),

  updateSubscription: (id: number, data: Prisma.EBookSubscriptionUncheckedUpdateInput) =>
    prisma.eBookSubscription.update({ where: { id }, data }),
  updateOrder: (id: number, data: Prisma.EBookOrderUncheckedUpdateInput) =>
    prisma.eBookOrder.update({ where: { id }, data }),
  deleteSubscription: (id: number) => prisma.eBookSubscription.delete({ where: { id } }),

  // ── search helpers (cross-table, for subscription search) ───────────────────────
  findCustomerIdsBySearch: async (q: string): Promise<number[]> => {
    const rows = await prisma.customer.findMany({
      where: buildPrismaSearch(q, ["fullName", "phoneNumber", "emailAddress"]) ?? {},
      select: { id: true },
    });
    return rows.map((r) => r.id);
  },
  findEbookIdsBySearch: async (q: string): Promise<number[]> => {
    const rows = await prisma.eBook.findMany({ where: buildPrismaSearch(q, ["name"]) ?? {}, select: { id: true } });
    return rows.map((r) => r.id);
  },
};

function buildEbookWhere(opts: { search?: string; author?: string; publisher?: string; language?: string; status?: boolean }): Prisma.EBookWhereInput {
  const where: Prisma.EBookWhereInput = {};
  const and: Prisma.EBookWhereInput[] = [];
  const search = buildPrismaSearch(opts.search, ["name", "author"]);
  if (search) and.push(search);
  const author = buildPrismaSearch(opts.author, ["author"]);
  if (author) and.push(author);
  const publisher = buildPrismaSearch(opts.publisher, ["publisher"]);
  if (publisher) and.push(publisher);
  if (opts.language) where.language = opts.language as any;
  if (opts.status !== undefined) where.active = opts.status;
  if (and.length) where.AND = and;
  return where;
}

function subSortCol(sortBy: string): string {
  if (sortBy === "startAt" || sortBy === "start_at") return "startAt";
  if (sortBy === "endAt" || sortBy === "end_at") return "endAt";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updatedAt";
  return "createdAt";
}

function buildSubWhere(opts: SubFilter): Prisma.EBookSubscriptionWhereInput {
  const where: Prisma.EBookSubscriptionWhereInput = {};
  if (opts.customerId !== undefined) where.customerId = opts.customerId;
  if (opts.ebookId !== undefined) where.ebookId = opts.ebookId;
  // Computed status: inactive = not active; expired = active but endAt in the past;
  // active = active and not expired. `statusFilter` wins over the legacy boolean.
  if (opts.statusFilter) {
    const now = opts.now ?? new Date();
    if (opts.statusFilter === "inactive") where.status = false;
    else if (opts.statusFilter === "expired") { where.status = true; where.endAt = { lt: now }; }
    else { where.status = true; where.endAt = { gte: now }; } // active
  } else if (opts.status !== undefined) {
    where.status = opts.status;
  }
  // Payment method lives on the linked order.
  if (opts.paymentMethod) where.eBookOrder = { is: { paymentMethod: opts.paymentMethod } };
  // Inclusive createdAt range (bounds pre-computed to day edges by the service).
  if (opts.dateFrom || opts.dateTo) {
    where.createdAt = {};
    if (opts.dateFrom) where.createdAt.gte = opts.dateFrom;
    if (opts.dateTo) where.createdAt.lte = opts.dateTo;
  }
  // search OR (customer-name/phone/email match | ebook-name match), AND-ed with filters.
  const or: Prisma.EBookSubscriptionWhereInput[] = [];
  if (opts.customerIdsIn?.length) or.push({ customerId: { in: opts.customerIdsIn } });
  if (opts.ebookIdsIn?.length) or.push({ ebookId: { in: opts.ebookIdsIn } });
  if (or.length) where.OR = or;
  return where;
}

export { OWNED };
