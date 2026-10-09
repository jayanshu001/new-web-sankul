// Admin promoters: promoter CRUD, attributed subscriptions, promocodes and dashboards.
import bcrypt from "bcryptjs";
import { prisma } from "../../config/prisma";
import { buildPrismaPrefixSearch } from "../../utils/searchFilter";
import { promoterDataRepository } from "../promoter-data/promoter-data.repository";
import {
  ALLOWED_RANGES,
  resolveRange,
  bucketFormatFor,
  type RangeKey,
} from "../promoter-data/promoter-data.range";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

/**
 * Admin promoter management (ws_promoter). The promoter DTO shape is frozen:
 *   { _id, fullName, email, phone, image, status, isDelete, createdAt, updatedAt,
 *     lastLoginDate, lastLoginIp }
 *
 * Known gaps (no column):
 *   • ws_promoter has no last_login_date / last_login_ip → surfaced as null.
 *   • ws_package_course_subscription has no promocode_id → the dashboard's
 *     `promocodeId` scope filter is ignored and recent rows' `promocode` is null.
 */

const SALT_ROUNDS = 10;

export const parsePromoterId = parsePositiveInt;

interface PromoterRow {
  id: number;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  image: string | null;
  status: boolean;
  is_delete: boolean;
  created_at: Date | null;
  updated_at: Date | null;
}

/** ws_promoter row → promoter DTO (no password). */
const toPromoterDto = (r: PromoterRow) => ({
  _id: String(r.id),
  fullName: r.full_name ?? "",
  email: r.email ?? "",
  phone: r.phone ?? "",
  image: r.image ?? null,
  status: r.status,
  isDelete: r.is_delete,
  lastLoginDate: null as Date | null,
  lastLoginIp: null as string | null,
  createdAt: r.created_at ?? null,
  updatedAt: r.updated_at ?? null,
});

const promoterSelect = {
  id: true,
  full_name: true,
  email: true,
  phone: true,
  image: true,
  status: true,
  is_delete: true,
  created_at: true,
  updated_at: true,
} as const;

export const listPromoters = async (opts: {
  search?: string;
  status?: boolean;
  page: number;
  limit: number;
}): Promise<{ data: any[]; total: number }> => {
  const where: Prisma.PromoterWhereInput = { is_delete: false };
  if (opts.status !== undefined) where.status = opts.status;
  const search = buildPrismaPrefixSearch(opts.search, ["full_name", "email", "phone"]);
  if (search) Object.assign(where, search);
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    prisma.promoter.findMany({
      where,
      select: promoterSelect,
      orderBy: [{ created_at: "desc" }, { id: "desc" }],
      skip,
      take: opts.limit,
    }),
    prisma.promoter.count({ where }),
  ]);
  return { data: rows.map((r) => toPromoterDto(r as PromoterRow)), total };
};

// Promoter with promocode and attributed-subscription counts.
export const getPromoter = async (promoterId: number): Promise<any | null> => {
  const row = await prisma.promoter.findFirst({
    where: { id: promoterId, is_delete: false },
    select: promoterSelect,
  });
  if (!row) return null;

  const [promocodeCount, subscriptionCount] = await Promise.all([
    prisma.promocode.count({ where: { promoterId } }),
    // Reuse the order-JSON attribution count from promoter-data.
    promoterDataRepository.countCourseSubs(promoterId, {}),
  ]);

  return { ...toPromoterDto(row as PromoterRow), stats: { promocodeCount, subscriptionCount } };
};

/** Returns { conflict: true } when email already in use, else the created DTO. */
export const createPromoter = async (data: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
  image?: string;
  status?: boolean;
}): Promise<{ conflict: true } | { conflict: false; data: any }> => {
  const email = data.email.toLowerCase();
  const existing = await prisma.promoter.findFirst({ where: { email } });
  if (existing) return { conflict: true };

  const hashed = await bcrypt.hash(data.password, SALT_ROUNDS);
  const now = new Date();
  const row = await prisma.promoter.create({
    data: {
      full_name: data.fullName,
      email,
      phone: data.phone,
      password: hashed,
      image: data.image ?? null,
      status: data.status ?? true,
      is_delete: false,
      created_at: now,
      updated_at: now,
    },
    select: promoterSelect,
  });
  return { conflict: false, data: toPromoterDto(row as PromoterRow) };
};

export const updatePromoter = async (
  promoterId: number,
  data: {
    fullName?: string;
    email?: string;
    phone?: string;
    password?: string;
    image?: string;
    status?: boolean;
  }
): Promise<any | null> => {
  const existing = await prisma.promoter.findFirst({
    where: { id: promoterId, is_delete: false },
    select: { id: true },
  });
  if (!existing) return null;

  const update: any = { updated_at: new Date() };
  if (data.fullName !== undefined) update.full_name = data.fullName;
  if (data.phone !== undefined) update.phone = data.phone;
  if (data.image !== undefined) update.image = data.image;
  if (data.status !== undefined) update.status = data.status;
  if (data.email !== undefined) update.email = data.email.toLowerCase();
  if (data.password !== undefined) update.password = await bcrypt.hash(data.password, SALT_ROUNDS);

  const row = await prisma.promoter.update({
    where: { id: promoterId },
    data: update,
    select: promoterSelect,
  });
  return toPromoterDto(row as PromoterRow);
};

// Soft delete: sets is_delete and deactivates.
export const deletePromoter = async (promoterId: number): Promise<boolean> => {
  const existing = await prisma.promoter.findUnique({
    where: { id: promoterId },
    select: { id: true },
  });
  if (!existing) return false;
  await prisma.promoter.update({
    where: { id: promoterId },
    data: { is_delete: true, status: false, updated_at: new Date() },
  });
  return true;
};

/** Toggles status; returns the new status, or null if not found. */
export const togglePromoterStatus = async (promoterId: number): Promise<boolean | null> => {
  const row = await prisma.promoter.findFirst({
    where: { id: promoterId, is_delete: false },
    select: { id: true, status: true },
  });
  if (!row) return null;
  const next = !row.status;
  await prisma.promoter.update({
    where: { id: promoterId },
    data: { status: next, updated_at: new Date() },
  });
  return next;
};

const numOf = (v: unknown): number => {
  if (v === null || v === undefined) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Attribution via ws_package_course_subscription.promoter_id. Frozen shape:
//   - customerId → { _id, firstName, lastName, phoneNumber } (firstName = full_name;
//     lastName has no column → "")
//   - courseId   → { _id, name }
// No pagination: the full array is returned under `data`.
export const getPromoterSubscriptions = async (promoterId: number): Promise<any[]> => {
  const rows = await prisma.packageCourseSubscription.findMany({
    where: { promoterId },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  if (!rows.length) return [];

  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is number => v != null))];
  const courseIds = [...new Set(rows.map((r) => r.courseId).filter((v): v is number => v != null))];

  const [customers, courses] = await Promise.all([
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, fullName: true, phoneNumber: true },
        })
      : Promise.resolve([]),
    courseIds.length
      ? prisma.course.findMany({
          where: { id: { in: courseIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  const custMap = new Map(
    customers.map((c) => [
      c.id,
      {
        _id: String(c.id),
        firstName: c.fullName ?? "",
        lastName: "",
        phoneNumber: c.phoneNumber ?? null,
      },
    ])
  );
  const courseMap = new Map(courses.map((c) => [c.id, { _id: String(c.id), name: c.name ?? "" }]));

  return rows.map((r) => ({
    _id: String(r.id),
    customerId: r.customerId != null ? custMap.get(r.customerId) ?? null : null,
    courseId: r.courseId != null ? courseMap.get(r.courseId) ?? null : null,
    targetPackageId: r.packageId != null ? String(r.packageId) : null,
    packageId: r.planId != null ? String(r.planId) : null,
    startAt: r.startAt ?? null,
    endAt: r.endAt ?? null,
    status: r.status,
    promoterId: String(promoterId),
    promoterPercentage: numOf(r.promoterPercentage),
    paidAmount: numOf(r.paidAmount),
    createdAt: r.createdAt ?? null,
    updatedAt: r.updatedAt ?? null,
  }));
};

// ws_promocode rows carry promoterId + appliesToType/appliesToIds + discount fields.
// Reuses the appliesTo populate contract from promo-code.service (type + populated
// { _id, name, image } refs). No pagination: the full array is returned.
const PROMO_APPLIES_TO_TYPES = ["package", "course", "liveCourse", "ebook", "testSeries"] as const;
type PromoAppliesToType = (typeof PROMO_APPLIES_TO_TYPES)[number];

const parseIdArr = (json: any): number[] => {
  const a = Array.isArray(json) ? json : [];
  const out: number[] = [];
  for (const v of a) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
};

const resolvePromoRefs = async (
  type: PromoAppliesToType,
  ids: number[]
): Promise<{ _id: string; name: string | null; image: string | null }[]> => {
  if (!ids.length) return [];
  let rows: { id: number; name: string | null; image: string | null }[] = [];
  switch (type) {
    case "package": {
      const r = await prisma.package.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.image ?? null }));
      break;
    }
    case "course": {
      const r = await prisma.course.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.image ?? null }));
      break;
    }
    case "liveCourse": {
      const r = await prisma.liveCourse.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, image: true } });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.image ?? null }));
      break;
    }
    case "ebook": {
      const r = await prisma.eBook.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, thumbnail: true } });
      rows = r.map((x) => ({ id: x.id, name: x.name ?? null, image: x.thumbnail ?? null }));
      break;
    }
    case "testSeries": {
      const r = await prisma.testSeries.findMany({ where: { id: { in: ids } }, select: { id: true, title: true, thumbnail: true } });
      rows = r.map((x) => ({ id: x.id, name: x.title ?? null, image: x.thumbnail ?? null }));
      break;
    }
  }
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ _id: String(r.id), name: r.name, image: r.image }));
};

export const getPromoterPromocodes = async (promoterId: number): Promise<any[]> => {
  const rows = await prisma.promocode.findMany({
    where: { promoterId },
    orderBy: { created_at: "desc" },
  });
  return Promise.all(
    rows.map(async (r) => {
      const type = r.appliesToType as PromoAppliesToType | null;
      const ids = parseIdArr(r.appliesToIds);
      let appliesTo: any = null;
      if (type) {
        const refs = ids.length ? await resolvePromoRefs(type, ids) : [];
        appliesTo = { type, ids: refs };
      }
      return {
        _id: String(r.id),
        type: r.type,
        promocode: r.promocode,
        title: r.title ?? "",
        description: r.description ?? "",
        promo_start_at: r.promo_start_at ?? null,
        promo_expire_at: r.promo_expire_at ?? null,
        status: r.status,
        discountType: r.discountType,
        discountValue: numOf(r.discountValue),
        promoterId: r.promoterId != null ? String(r.promoterId) : null,
        appliesTo,
        createdAt: r.created_at ?? null,
        updatedAt: r.updated_at ?? null,
      };
    })
  );
};

// Dashboard off the promoter columns on ws_package_course_subscription:
//   earnings   = SUM(paid_amount)
//   commission = SUM(paid_amount * promoter_percentage / 100)
// `promoterId === null` ⇒ aggregate over all promoter-attributed rows.
// There is no promocode_id column, so the `promocodeId` scope filter is ignored and
// recent rows' `promocode` is always null.
type DashboardScope = { promoterId: number | null; rangeRaw?: string; promocodeId?: string; startDate?: string; endDate?: string };

const buildPromoterDashboardSql = async (scope: DashboardScope) => {
  const range: RangeKey = ALLOWED_RANGES.includes(scope.rangeRaw as RangeKey)
    ? (scope.rangeRaw as RangeKey)
    : "all";
  const now = new Date();
  const { start, end } = resolveRange(range, now, { startDate: scope.startDate, endDate: scope.endDate });
  const { unit } = bucketFormatFor(range, { start, end });

  const where: Prisma.PackageCourseSubscriptionWhereInput = {};
  // One promoter, or all promoter-attributed rows (excludes regular purchases with a
  // null promoterId).
  where.promoterId = scope.promoterId != null ? scope.promoterId : { not: null };
  if (start || end) {
    where.createdAt = {};
    if (start) where.createdAt.gte = start;
    if (end) where.createdAt.lte = end;
  }

  const rows = await prisma.packageCourseSubscription.findMany({
    where,
    select: {
      id: true,
      customerId: true,
      courseId: true,
      paidAmount: true,
      promoterPercentage: true,
      status: true,
      createdAt: true,
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });

  let earnings = 0;
  let commission = 0;
  const buckets = new Map<string, { subscriptions: number; earnings: number }>();
  const fmt = unit; // "hour" | "day" | "month"
  const bucketKey = (d: Date | null): string => {
    if (!d) return "";
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const h = String(d.getHours()).padStart(2, "0");
    if (fmt === "hour") return `${y}-${m}-${day} ${h}:00`;
    if (fmt === "day") return `${y}-${m}-${day}`;
    return `${y}-${m}`;
  };

  for (const r of rows) {
    const paid = numOf(r.paidAmount);
    const pct = numOf(r.promoterPercentage);
    earnings += paid;
    commission += (paid * pct) / 100;
    const key = bucketKey(r.createdAt);
    const b = buckets.get(key) ?? { subscriptions: 0, earnings: 0 };
    b.subscriptions += 1;
    b.earnings += paid;
    buckets.set(key, b);
  }

  const series = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([bucket, v]) => ({ bucket, subscriptions: v.subscriptions, earnings: v.earnings }));

  // Recents: most-recent 5; promocode is null (no linkage column).
  const recent = rows.slice(0, 5);
  const rCustIds = [...new Set(recent.map((r) => r.customerId).filter((v): v is number => v != null))];
  const rCourseIds = [...new Set(recent.map((r) => r.courseId).filter((v): v is number => v != null))];
  const [rCustomers, rCourses] = await Promise.all([
    rCustIds.length
      ? prisma.customer.findMany({ where: { id: { in: rCustIds } }, select: { id: true, fullName: true, phoneNumber: true } })
      : Promise.resolve([]),
    rCourseIds.length
      ? prisma.course.findMany({ where: { id: { in: rCourseIds } }, select: { id: true, name: true } })
      : Promise.resolve([]),
  ]);
  const rCustMap = new Map(rCustomers.map((c) => [c.id, c]));
  const rCourseMap = new Map(rCourses.map((c) => [c.id, c]));

  const recentSubscriptions = recent.map((s) => {
    const c = s.customerId != null ? rCustMap.get(s.customerId) : undefined;
    const course = s.courseId != null ? rCourseMap.get(s.courseId) : undefined;
    const name = c ? (c.fullName ?? "").trim() || "Unknown" : "Unknown";
    return {
      id: String(s.id),
      customer: {
        id: c ? String(c.id) : null,
        name,
        phoneNumber: c?.phoneNumber ?? null,
      },
      course: course ? { id: String(course.id), name: course.name ?? "" } : null,
      promocode: null as string | null,
      amount: numOf(s.paidAmount),
      status: s.status ? "complete" : "pending",
      createdAt: s.createdAt,
    };
  });

  return {
    range,
    window: { start, end },
    totals: {
      subscriptions: rows.length,
      earnings: Math.round(earnings || 0),
      commission: Math.round(commission || 0),
    },
    chart: { unit, points: series },
    recentSubscriptions,
  };
};

/** Per-promoter dashboard. Returns null when the promoter doesn't exist. */
export const getPromoterDashboard = async (
  promoterId: number,
  opts: { rangeRaw?: string; promocodeId?: string; startDate?: string; endDate?: string }
): Promise<any | null> => {
  const exists = await prisma.promoter.findFirst({
    where: { id: promoterId, is_delete: false },
    select: { id: true },
  });
  if (!exists) return null;
  return buildPromoterDashboardSql({ promoterId, ...opts });
};

/** Aggregate dashboard across all promoter-attributed subscriptions. */
export const getAllPromotersDashboard = async (opts: {
  rangeRaw?: string;
  promocodeId?: string;
  startDate?: string;
  endDate?: string;
}): Promise<any> => buildPromoterDashboardSql({ promoterId: null, ...opts });
