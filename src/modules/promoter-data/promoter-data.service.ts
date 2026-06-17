import { isMysqlModule } from "../../config/migration";
import { promoterDataRepository as repo } from "./promoter-data.repository";
import { prisma } from "../../config/prisma";

export const PROMOTER_DATA_MODULE = "promoter-data";
export const isPromoterDataMysql = (): boolean => isMysqlModule(PROMOTER_DATA_MODULE);

export const parsePromoterId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const fullToName = (full: string | null | undefined): string => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.join(" ") : "Unknown";
};

const splitName = (full: string | null | undefined) => {
  const parts = (full ?? "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] ?? "", lastName: parts.length > 1 ? parts[parts.length - 1] : "" };
};

// ─── Customers attributed to a promoter ──────────────────────────────────────
export const listPromoterCustomers = async (
  promoterId: number,
  opts: { search?: string; page: number; limit: number }
): Promise<{ items: any[]; total: number }> => {
  const ids = await repo.listCustomerIds(promoterId);
  if (!ids.length) return { items: [], total: 0 };

  const where: any = { id: { in: ids }, isAccountDeleted: false };
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [
      { fullName: { contains: q } },
      { phoneNumber: { contains: q } },
      { emailAddress: { contains: q } },
    ];
  }
  const skip = (opts.page - 1) * opts.limit;
  const [rows, total] = await Promise.all([
    prisma.customer.findMany({
      where,
      select: { id: true, fullName: true, phoneNumber: true, emailAddress: true, city: true, gender: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip,
      take: opts.limit,
    }),
    prisma.customer.count({ where }),
  ]);

  const items = rows.map((c) => {
    const { firstName, lastName } = splitName(c.fullName);
    return {
      _id: String(c.id),
      firstName,
      lastName,
      phoneNumber: c.phoneNumber,
      emailAddress: c.emailAddress ?? null,
      city: c.city ?? null,
      gender: c.gender ?? null,
      createdAt: c.createdAt ?? null,
    };
  });
  return { items, total };
};

// ─── Subscriptions (course / ebook) attributed to a promoter ─────────────────
export const listPromoterSubscriptions = async (
  promoterId: number,
  opts: { type: "course" | "ebook"; from?: Date; to?: Date; page: number; limit: number }
): Promise<{ items: any[]; total: number }> => {
  const skip = (opts.page - 1) * opts.limit;
  if (opts.type === "ebook") {
    const [rows, total] = await Promise.all([
      repo.listEbookSubs(promoterId, { from: opts.from, to: opts.to, skip, take: opts.limit }),
      repo.countEbookSubs(promoterId, { from: opts.from, to: opts.to }),
    ]);
    return {
      items: rows.map((s) => ({
        _id: String(s.id),
        customerId: s.customerId ? { _id: String(s.customerId), ...splitName(s.customerName), phoneNumber: s.customerPhone } : null,
        ebookId: s.ebookId ? { _id: String(s.ebookId), name: s.ebookName ?? "", author: s.ebookAuthor ?? "" } : null,
        price: Number(s.amount) || 0,
        promocode: s.promocode ?? null,
        status: !!s.status,
        createdAt: s.createdAt ?? null,
      })),
      total,
    };
  }
  const [rows, total] = await Promise.all([
    repo.listCourseSubs(promoterId, { from: opts.from, to: opts.to, skip, take: opts.limit }),
    repo.countCourseSubs(promoterId, { from: opts.from, to: opts.to }),
  ]);
  return {
    items: rows.map((s) => ({
      _id: String(s.id),
      customerId: s.customerId ? { _id: String(s.customerId), ...splitName(s.customerName), phoneNumber: s.customerPhone } : null,
      courseId: s.courseId ? { _id: String(s.courseId), name: s.courseName ?? "" } : null,
      paidAmount: Number(s.amount) || 0,
      promoterPercentage: Number(s.pct) || 0,
      promocode: s.promocode ?? null,
      status: !!s.status,
      createdAt: s.createdAt ?? null,
    })),
    total,
  };
};

// ─── Dashboard summary (mirrors src/promoter/dashboard getDashboard) ─────────
export const buildPromoterDashboard = async (promoterId: number) => {
  const now = new Date();
  const [courseAll, courseActive, ebook, recentRows, activePromo, totalPromo] = await Promise.all([
    repo.courseTotals(promoterId),
    repo.courseTotals(promoterId, { activeOnly: true, now }),
    repo.ebookRevenue(promoterId),
    repo.listCourseSubs(promoterId, { skip: 0, take: 10 }),
    countPromoterPromocodes(promoterId, true, now),
    countPromoterPromocodes(promoterId, false, now),
  ]);

  const recentSubscriptions = recentRows.map((s) => ({
    _id: String(s.id),
    customerId: s.customerId ? { _id: String(s.customerId), ...splitName(s.customerName), phoneNumber: s.customerPhone } : null,
    courseId: s.courseId ? { _id: String(s.courseId), name: s.courseName ?? "" } : null,
    paidAmount: Number(s.amount) || 0,
    createdAt: s.createdAt ?? null,
  }));

  return {
    summary: {
      promocodeCount: totalPromo,
      activePromocodeCount: activePromo,
      subscriptionCount: courseAll.subscriptions,
      activeSubscriptionCount: courseActive.subscriptions,
      ebookSubscriptionCount: ebook.subscriptions,
      uniqueCustomerCount: courseAll.uniqueCustomers,
      courseRevenue: courseAll.earnings,
      ebookRevenue: ebook.earnings,
      totalRevenue: courseAll.earnings + ebook.earnings,
      commissionEarned: Math.round(courseAll.commission),
    },
    recentSubscriptions,
  };
};

/** Count this promoter's promocodes (ws_promocode.promoter_id). */
const countPromoterPromocodes = async (promoterId: number, activeOnly: boolean, now: Date): Promise<number> => {
  const where: any = { promoterId };
  if (activeOnly) {
    where.status = true;
    where.promo_expire_at = { gt: now };
  }
  return prisma.promocode.count({ where });
};

// ─── Dashboard overview (date-range bucketed time series) ────────────────────
type RangeKey = "today" | "week" | "month" | "year" | "all" | "custom";
const ALLOWED: RangeKey[] = ["today", "week", "month", "year", "all", "custom"];

const parseYmd = (raw?: string): Date | null => {
  if (!raw) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
};

const resolveRange = (key: RangeKey, now: Date, custom?: { startDate?: string; endDate?: string }) => {
  const start = new Date(now); start.setHours(0, 0, 0, 0);
  switch (key) {
    case "today": return { start, end: now };
    case "week": { const s = new Date(start); s.setDate(s.getDate() - 6); return { start: s, end: now }; }
    case "month": return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
    case "year": return { start: new Date(now.getFullYear(), 0, 1), end: now };
    case "custom": {
      const s = parseYmd(custom?.startDate); const e = parseYmd(custom?.endDate);
      if (e) e.setHours(23, 59, 59, 999);
      return { start: s as Date | null, end: e && e <= now ? e : now };
    }
    default: return { start: null as Date | null, end: now };
  }
};

const bucketFmt = (key: RangeKey, w: { start: Date | null; end: Date }): { fmt: string; unit: string } => {
  switch (key) {
    case "today": return { fmt: "%Y-%m-%d %H:00", unit: "hour" };
    case "week": case "month": return { fmt: "%Y-%m-%d", unit: "day" };
    case "custom": {
      if (!w.start) return { fmt: "%Y-%m", unit: "month" };
      const days = (w.end.getTime() - w.start.getTime()) / 86_400_000;
      if (days <= 2) return { fmt: "%Y-%m-%d %H:00", unit: "hour" };
      if (days <= 92) return { fmt: "%Y-%m-%d", unit: "day" };
      return { fmt: "%Y-%m", unit: "month" };
    }
    default: return { fmt: "%Y-%m", unit: "month" };
  }
};

export const buildPromoterOverview = async (
  promoterId: number,
  rangeRaw?: string,
  opts?: { startDate?: string; endDate?: string }
) => {
  const range: RangeKey = ALLOWED.includes(rangeRaw as RangeKey) ? (rangeRaw as RangeKey) : "all";
  const now = new Date();
  const { start, end } = resolveRange(range, now, opts);
  const { fmt, unit } = bucketFmt(range, { start, end });
  const win = { from: start ?? undefined, to: end };

  const [totals, seriesRows, recentRows] = await Promise.all([
    repo.courseTotals(promoterId, win),
    repo.courseSeries(promoterId, fmt, win),
    repo.listCourseSubs(promoterId, { from: win.from, to: win.to, skip: 0, take: 5 }),
  ]);

  return {
    range,
    window: { start, end },
    totals: {
      subscriptions: totals.subscriptions,
      earnings: Math.round(totals.earnings),
      commission: Math.round(totals.commission),
    },
    chart: {
      unit,
      points: seriesRows.map((b) => ({ bucket: b.bucket, subscriptions: Number(b.subscriptions) || 0, earnings: Number(b.earnings) || 0 })),
    },
    recentSubscriptions: recentRows.map((s) => ({
      id: String(s.id),
      customer: { id: s.customerId ? String(s.customerId) : null, name: fullToName(s.customerName), phoneNumber: s.customerPhone ?? null },
      course: s.courseId ? { id: String(s.courseId), name: s.courseName ?? "" } : null,
      promocode: s.promocode ?? null,
      amount: Number(s.amount) || 0,
      status: s.status ? "complete" : "pending",
      createdAt: s.createdAt ?? null,
    })),
  };
};

// ─── Promocodes owned by a promoter (+ usage) ────────────────────────────────
// ⚠ SQL-faithful only: ws_promocode has NO appliesTo/discountValue (same limit
// as commerce-promocode). We list the promoter's codes + derived usage; appliesTo
// is returned empty (the Mongo client-side appliesTo model isn't reproducible).
const toPromocodeDto = (p: any, usage?: { count: number; revenue: number }) => ({
  _id: String(p.id),
  promocode: p.promocode ?? null,
  title: p.title ?? null,
  description: p.description ?? null,
  type: p.type,
  status: p.status,
  promoStartAt: p.promo_start_at ?? null,
  promoExpireAt: p.promo_expire_at ?? null,
  appliesTo: { type: null, ids: [] as unknown[] }, // not representable from SQL
  usageCount: usage?.count ?? 0,
  revenue: usage?.revenue ?? 0,
  createdAt: p.created_at ?? null,
  updatedAt: p.updated_at ?? null,
});

export const listPromoterPromocodes = async (promoterId: number) => {
  const [codes, usage] = await Promise.all([
    prisma.promocode.findMany({ where: { promoterId }, orderBy: [{ created_at: "desc" }, { id: "desc" }] }),
    repo.promocodeUsage(promoterId),
  ]);
  return codes.map((p) => toPromocodeDto(p, p.promocode ? usage.get(p.promocode) : undefined));
};

export const getPromoterPromocode = async (promoterId: number, promocodeId: number) => {
  const p = await prisma.promocode.findFirst({ where: { id: promocodeId, promoterId } });
  if (!p) return null;
  const usage = await repo.promocodeUsage(promoterId);
  return toPromocodeDto(p, p.promocode ? usage.get(p.promocode) : undefined);
};

export { fullToName };
