import { isMysqlModule } from "../../config/migration";
import { splitFullName } from "../customer-profile/customer-profile.name";
import { adminSubscriptionRepository as repo } from "./admin-subscription.repository";

export const ADMIN_SUBSCRIPTION_MODULE = "admin-subscription";
export const isAdminSubscriptionMysql = (): boolean => isMysqlModule(ADMIN_SUBSCRIPTION_MODULE);

export const parseSubId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const idStr = (v: number | null | undefined): string | null => (v != null && v > 0 ? String(v) : null);
const customerRef = (c: { id: number; fullName: string | null; phoneNumber: string; emailAddress?: string | null } | undefined) => {
  if (!c) return null;
  const { firstName, lastName } = splitFullName(c.fullName);
  return { _id: String(c.id), firstName, lastName, phoneNumber: c.phoneNumber, ...(c.emailAddress !== undefined ? { emailAddress: c.emailAddress ?? null } : {}) };
};

// ── course/package subscription list ─────────────────────────────────────────
export const listCourseSubscriptions = async (q: {
  customerId?: string; courseId?: string; packageId?: string; status?: string;
  fromDate?: string; toDate?: string; search?: string; sortBy?: string; sortOrder?: string; type?: string;
  page: number; limit: number;
}) => {
  let customerIdsIn: number[] | undefined, courseIdsIn: number[] | undefined, packageIdsIn: number[] | undefined;
  if (q.search) {
    [customerIdsIn, courseIdsIn, packageIdsIn] = await Promise.all([
      repo.customerIdsByText(q.search), repo.courseIdsByText(q.search), repo.packageIdsByText(q.search),
    ]);
    if (!customerIdsIn.length && !courseIdsIn.length && !packageIdsIn.length)
      return { items: [], pagination: { page: q.page, limit: q.limit, total: 0, totalPages: 0 } };
  }
  const opts = {
    customerId: q.customerId ? parseSubId(q.customerId) ?? undefined : undefined,
    courseId: q.courseId ? parseSubId(q.courseId) ?? undefined : undefined,
    packageId: q.packageId ? parseSubId(q.packageId) ?? undefined : undefined,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
    fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
    toDate: q.toDate ? new Date(q.toDate) : undefined,
    type: (q.type === "course" || q.type === "package" ? q.type : undefined) as "course" | "package" | undefined,
    customerIdsIn, courseIdsIn, packageIdsIn,
    sortBy: q.sortBy ?? "createdAt", sortDir: (q.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
  };
  const [rows, total] = await Promise.all([
    repo.listCourseSubs({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countCourseSubs(opts as any),
  ]);

  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const courses = new Map((await repo.coursesByIds([...new Set(rows.map((r) => r.courseId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const packages = new Map((await repo.packagesByIds([...new Set(rows.map((r) => r.packageId).filter((x): x is number => x != null && x > 0))])).map((p) => [p.id, p]));
  const plans = new Map((await repo.plansByIds([...new Set(rows.map((r) => r.planId).filter((x): x is number => x != null && x > 0))])).map((p) => [p.id, p]));

  const items = rows.map((r) => {
    const course = r.courseId ? courses.get(r.courseId) : null;
    const pkg = r.packageId ? packages.get(r.packageId) : null;
    const plan = r.planId ? plans.get(r.planId) : null;
    return {
      _id: String(r.id),
      customerId: customerRef(r.customerId ? custs.get(r.customerId) : undefined),
      courseId: course ? { _id: String(course.id), name: course.name, image: course.image ?? null } : null,
      targetPackageId: pkg ? { _id: String(pkg.id), name: pkg.name, image: pkg.image ?? null } : null,
      planId: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: plan.price } : null,
      paidAmount: r.amount != null ? Number(r.amount) : 0,
      startAt: r.startAt ?? null,
      endAt: r.endAt ?? null,
      paymentMethod: r.payment_type ?? null,
      paymentStatus: null, // Mongo-only (no payment_status column) — status conveys active
      status: r.status,
      withMaterial: r.pcMaterialId != null && r.pcMaterialId > 0,
      remark: r.remarks ?? null,
      createdAt: r.createdAt ?? null,
      updatedAt: r.updatedAt ?? null,
    };
  });
  return { items, pagination: { page: q.page, limit: q.limit, total, totalPages: Math.ceil(total / q.limit) } };
};

export const getCourseSubscriptionById = async (id: number): Promise<"not_found" | any> => {
  const r = await repo.findCourseSubById(id);
  if (!r) return "not_found";
  const [cust] = r.customerId ? await repo.customersByIds([r.customerId]) : [undefined];
  const [course] = r.courseId ? await repo.coursesByIds([r.courseId]) : [undefined];
  const [plan] = r.planId ? await repo.plansByIds([r.planId]) : [undefined];
  return {
    _id: String(r.id),
    customerId: customerRef(cust),
    courseId: course ? { _id: String(course.id), name: course.name, image: course.image ?? null } : idStr(r.courseId),
    packageId: idStr(r.packageId),
    planId: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.duration, price: plan.price } : idStr(r.planId),
    paidAmount: r.amount != null ? Number(r.amount) : 0,
    startAt: r.startAt ?? null, endAt: r.endAt ?? null,
    status: r.status, paymentMethod: r.payment_type ?? null, remark: r.remarks ?? null,
    withMaterial: r.pcMaterialId != null && r.pcMaterialId > 0,
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  };
};

export const listPlansForTarget = async (courseId?: number, packageId?: number) => {
  const plans = await repo.plansForTarget({ courseId, packageId });
  return plans.map((p) => ({ _id: String(p.id), name: p.name ?? null, duration: p.duration, price: p.price, materialPrice: p.materialPrice ?? 0, withMaterial: p.withMaterial, isDefault: p.isDefault, status: p.status, courseId: idStr(p.courseId), packageId: idStr(p.packageId) }));
};

// ── ebook subscriptions list ────────────────────────────────────────────────────
export const listEbookSubscriptions = async (q: { customerId?: string; ebookId?: string; status?: string; fromDate?: string; toDate?: string; page: number; limit: number }) => {
  const opts = {
    customerId: q.customerId ? parseSubId(q.customerId) ?? undefined : undefined,
    ebookId: q.ebookId ? parseSubId(q.ebookId) ?? undefined : undefined,
    status: q.status === "true" ? true : q.status === "false" ? false : undefined,
    fromDate: q.fromDate ? new Date(q.fromDate) : undefined,
    toDate: q.toDate ? new Date(q.toDate) : undefined,
  };
  const [rows, total] = await Promise.all([
    repo.listEbookSubs({ ...opts, skip: (q.page - 1) * q.limit, take: q.limit }),
    repo.countEbookSubs(opts),
  ]);
  const custs = new Map((await repo.customersByIds([...new Set(rows.map((r) => r.customerId).filter((x): x is number => x != null && x > 0))])).map((c) => [c.id, c]));
  const ebooks = new Map((await repo.ebooksByIds([...new Set(rows.map((r) => r.ebookId).filter((x): x is number => x != null && x > 0))])).map((e) => [e.id, e]));
  const data = rows.map((r) => ({
    _id: String(r.id),
    customerId: customerRef(r.customerId ? custs.get(r.customerId) : undefined),
    ebookId: r.ebookId && ebooks.get(r.ebookId) ? { _id: String(r.ebookId), name: ebooks.get(r.ebookId)!.name, author: ebooks.get(r.ebookId)!.author ?? null } : idStr(r.ebookId),
    price: r.price != null ? Number(r.price) : 0,
    startAt: r.startAt ?? null, endAt: r.endAt ?? null, status: r.status,
    createdAt: r.createdAt ?? null, updatedAt: r.updatedAt ?? null,
  }));
  return { data, pagination: { total, page: q.page, limit: q.limit, totalPages: Math.ceil(total / q.limit) } };
};

// ── reports ────────────────────────────────────────────────────────────────────
const dateWhere = (fromDate?: string, toDate?: string) => {
  if (!fromDate && !toDate) return {};
  const createdAt: any = {};
  if (fromDate) createdAt.gte = new Date(fromDate);
  if (toDate) createdAt.lte = new Date(toDate);
  return { createdAt };
};

export const reportSummary = async (fromDate?: string, toDate?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const [totalCourse, activeCourse, totalEbook, activeEbook, ebookRev, bookRev, bookTotal] = await Promise.all([
    repo.countSubs(dw),
    repo.countSubs({ ...dw, status: true }),
    repo.countEbookSubsRaw(dw),
    repo.countEbookSubsRaw({ ...dw, status: true }),
    repo.ebookOrderRevenue({ status: "complete" as any, ...dw }),
    repo.bookOrderRevenue({ status: "verified", ...dw }),
    repo.countBookOrders(dw),
  ]);
  const ebookRevenue = ebookRev._sum.orderPrice ?? 0;
  const bookRevenue = bookRev._sum.amount != null ? Number(bookRev._sum.amount) : 0;
  return {
    courseSubscriptions: { total: totalCourse, active: activeCourse },
    ebookSubscriptions: { total: totalEbook, active: activeEbook, revenue: ebookRevenue, orderCount: ebookRev._count._all },
    bookOrders: { total: bookTotal, verifiedCount: bookRev._count._all, revenue: bookRevenue },
    totalRevenue: ebookRevenue + bookRevenue,
  };
};

export const reportByCourse = async (fromDate?: string, toDate?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const [totals, actives] = await Promise.all([
    repo.subsByCourse({ ...dw, courseId: { gt: 0 } }),
    repo.subsByCourseActive({ ...dw, courseId: { gt: 0 } }),
  ]);
  const activeBy = new Map(actives.map((a) => [a.courseId, a._count._all]));
  const courseIds = totals.map((t) => t.courseId).filter((x): x is number => x != null);
  const courses = new Map((await repo.coursesByIds(courseIds)).map((c) => [c.id, c]));
  return totals
    .map((t) => ({
      _id: idStr(t.courseId),
      course: t.courseId && courses.get(t.courseId) ? { _id: String(t.courseId), name: courses.get(t.courseId)!.name, image: courses.get(t.courseId)!.image ?? null } : null,
      totalSubscriptions: t._count._all,
      activeSubscriptions: activeBy.get(t.courseId) ?? 0,
    }))
    .sort((a, b) => b.totalSubscriptions - a.totalSubscriptions);
};

export const reportByEbook = async (fromDate?: string, toDate?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const [grp, actives] = await Promise.all([
    repo.ebookSubsByEbook(dw),
    repo.ebookSubsByEbookActive(dw),
  ]);
  const activeBy = new Map(actives.map((a) => [a.ebookId, a._count._all]));
  const ebookIds = grp.map((g) => g.ebookId).filter((x): x is number => x != null);
  const ebooks = new Map((await repo.ebooksByIds(ebookIds)).map((e) => [e.id, e]));
  return grp
    .map((g) => ({
      _id: idStr(g.ebookId),
      ebook: g.ebookId && ebooks.get(g.ebookId) ? { _id: String(g.ebookId), name: ebooks.get(g.ebookId)!.name, author: ebooks.get(g.ebookId)!.author ?? null } : null,
      totalSubscriptions: g._count._all,
      activeSubscriptions: activeBy.get(g.ebookId) ?? 0,
      revenue: g._sum.price != null ? Number(g._sum.price) : 0,
    }))
    .sort((a, b) => b.revenue - a.revenue);
};

export const reportBookOrders = async (fromDate?: string, toDate?: string, status?: string) => {
  const dw = dateWhere(fromDate, toDate);
  const grp = await repo.bookOrdersByStatus({ ...dw, ...(status ? { status } : {}) });
  return grp.map((g) => ({ _id: g.status, count: g._count._all, revenue: g._sum.amount != null ? Number(g._sum.amount) : 0 }));
};
