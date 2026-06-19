/**
 * Admin test-series reads/CRUD — SQL (Prisma) branch.
 *
 * Gated behind `isMysqlModule("admin-testseries")`. Mirrors the Mongo handlers
 * in src/admin/testSeries/testSeries.controller.ts one-for-one, holding response
 * shapes + status codes identical. The controller branches each handler on
 * `isAdminTestSeriesMysql()` BEFORE its 24-hex ObjectId guard, parses ids via
 * `parseAtsId`, and keeps the Mongo path intact as a fallback.
 *
 * Conventions (same as client-testseries.service.ts):
 *   - `_id` is the SQL int stringified.
 *   - Decimal columns surfaced via `num`.
 *   - `examCategoryIds` is a JSON int[] on ws_test_series; on read it is
 *     populated to `[{ _id, name }]` (Mongo `.populate` parity); on write the
 *     legacy single `examCategoryId` int column is kept in sync (first id).
 *
 * Net-new column gap: none required — every field the Mongo handlers touch has
 * a column. `examCategoryIds` (Json), `examCategoryId` (Int), and the
 * subscription `paymentType` String column all exist.
 *
 * Drift / Mongo-only that stays on Mongo (controller keeps its Mongo branch):
 *   - listSubscriptions / listOrders customer populate: SQL surfaces
 *     `{ _id, name, phone, email }` from the Customer table where available.
 *   - TestSeriesOrder is read-only here (listOrders).
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const ADMIN_TESTSERIES_MODULE = "admin-testseries";
export const isAdminTestSeriesMysql = (): boolean => isMysqlModule(ADMIN_TESTSERIES_MODULE);

export const parseAtsId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

const num = (v: any): number => (v == null ? 0 : Number(v.toString?.() ?? v) || 0);

// ── examCategoryIds JSON helpers (read populate) ───────────────────────────────

const collectCatIds = (rawIdLists: any[]): number[] => {
  const ids = new Set<number>();
  for (const raw of rawIdLists) {
    if (Array.isArray(raw)) {
      for (const v of raw) {
        const n = Number(v);
        if (Number.isInteger(n) && n > 0) ids.add(n);
      }
    }
  }
  return [...ids];
};

const buildExamCategoryMap = async (
  rawIdLists: any[]
): Promise<Map<number, { _id: string; name: string | null }>> => {
  const ids = collectCatIds(rawIdLists);
  if (!ids.length) return new Map();
  const cats = await prisma.examCategory.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(cats.map((c) => [c.id, { _id: String(c.id), name: c.name ?? null }]));
};

const populateExamCategories = (
  raw: any,
  catMap: Map<number, { _id: string; name: string | null }>
): { _id: string; name: string | null }[] => {
  if (!Array.isArray(raw)) return [];
  const out: { _id: string; name: string | null }[] = [];
  for (const v of raw) {
    const n = Number(v);
    const hit = Number.isInteger(n) ? catMap.get(n) : undefined;
    if (hit) out.push(hit);
  }
  return out;
};

// Normalize an incoming examCategoryIds (string[] of int-ish ids) to int[] and
// derive the legacy single examCategoryId column (first id, else null).
const resolveCategoryWrite = (
  examCategoryIds: any[] | undefined,
  examCategoryId: any
): { examCategoryIds?: number[]; examCategoryId?: number | null } => {
  if (examCategoryIds !== undefined) {
    const ids = (Array.isArray(examCategoryIds) ? examCategoryIds : [])
      .map((v) => Number(v))
      .filter((n) => Number.isInteger(n) && n > 0);
    return { examCategoryIds: ids, examCategoryId: ids[0] ?? null };
  }
  if (examCategoryId !== undefined) {
    const single = examCategoryId != null ? Number(examCategoryId) : null;
    const ok = single != null && Number.isInteger(single) && single > 0 ? single : null;
    return { examCategoryIds: ok != null ? [ok] : [], examCategoryId: ok };
  }
  return {};
};

// ── DTOs (shape parity with Mongo lean docs) ──────────────────────────────────

const seriesDto = (
  s: any,
  catMap: Map<number, { _id: string; name: string | null }>
) => ({
  _id: String(s.id),
  title: s.title,
  description: s.description ?? null,
  thumbnail: s.thumbnail ?? null,
  examCategoryIds: populateExamCategories(s.examCategoryIds, catMap),
  examCategoryId: s.examCategoryId != null ? String(s.examCategoryId) : null,
  language: s.language,
  paperCount: s.paperCount,
  isFree: s.isFree,
  instructions: s.instructions ?? null,
  policy: s.policy ?? null,
  orderBy: s.orderBy,
  status: s.status,
  createdAt: s.createdAt ?? null,
  updatedAt: s.updatedAt ?? null,
});

const contentCategoryDto = (c: any) => ({
  _id: String(c.id),
  testSeriesId: String(c.testSeriesId),
  name: c.name,
  icon: c.icon ?? null,
  orderBy: c.orderBy,
  status: c.status,
  createdAt: c.createdAt ?? null,
  updatedAt: c.updatedAt ?? null,
});

const priceDto = (p: any) => ({
  _id: String(p.id),
  testSeriesId: String(p.testSeriesId),
  name: p.name ?? null,
  durationDays: p.durationDays,
  price: num(p.price),
  originalPrice: p.originalPrice != null ? num(p.originalPrice) : null,
  isDefault: p.isDefault,
  status: p.status,
  createdAt: p.createdAt ?? null,
  updatedAt: p.updatedAt ?? null,
});

// Paper-link DTO. `examId` / `contentCategoryId` are objects when populated
// (Mongo `.populate` parity), else the bare id string.
const paperDto = (
  l: any,
  examMap?: Map<number, any>,
  catMap?: Map<number, any>
) => ({
  _id: String(l.id),
  testSeriesId: String(l.testSeriesId),
  contentCategoryId:
    catMap && l.contentCategoryId != null
      ? catMap.get(l.contentCategoryId) ?? String(l.contentCategoryId)
      : String(l.contentCategoryId),
  examId:
    examMap && l.examId != null
      ? examMap.get(l.examId) ?? String(l.examId)
      : String(l.examId),
  orderBy: l.orderBy,
  status: l.status,
  createdAt: l.createdAt ?? null,
  updatedAt: l.updatedAt ?? null,
});

const examShortDto = (e: any) => ({
  _id: String(e.id),
  title: e.name,
  durationMinutes: e.time,
  questionCount: e.numberOfQuestions,
  language: null,
  status: e.status,
});

const subscriptionDto = (s: any) => ({
  _id: String(s.id),
  orderId: s.orderId != null ? String(s.orderId) : null,
  customerId: s.customerId != null ? String(s.customerId) : null,
  testSeriesId: s.testSeriesId != null ? String(s.testSeriesId) : null,
  planId: s.planId != null ? String(s.planId) : null,
  price: num(s.price),
  startAt: s.startAt ?? null,
  endAt: s.endAt ?? null,
  remarks: s.remarks ?? null,
  paymentType: s.paymentType,
  status: s.status,
  createdAt: s.createdAt ?? null,
  updatedAt: s.updatedAt ?? null,
});

// ── Series CRUD ───────────────────────────────────────────────────────────────

const defaultPlanPreview = (p: any) => ({
  _id: String(p.id),
  name: p.name ?? null,
  durationDays: p.durationDays,
  price: num(p.price),
  originalPrice: p.originalPrice != null ? num(p.originalPrice) : null,
  isDefault: p.isDefault,
  status: p.status,
});

export type ListSeriesOpts = {
  search: string | null;
  status: boolean | null;
  catIds: number[];
  page: number;
  limit: number;
};

export const listTestSeries = async (opts: ListSeriesOpts) => {
  const where: any = {};
  if (opts.search) where.title = { contains: opts.search };
  if (opts.status !== null) where.status = opts.status;

  const [rows, total] = await Promise.all([
    prisma.testSeries.findMany({
      where,
      orderBy: [{ orderBy: "asc" }, { createdAt: "desc" }],
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.testSeries.count({ where }),
  ]);

  // Filter on examCategory membership (legacy single OR new array) in-memory:
  // the array lives in a JSON column, which can't be queried portably. The
  // controller's Mongo path matched against both fields.
  let filtered = rows;
  if (opts.catIds.length) {
    const want = new Set(opts.catIds);
    filtered = rows.filter((r) => {
      if (r.examCategoryId != null && want.has(r.examCategoryId)) return true;
      const arr = r.examCategoryIds;
      return Array.isArray(arr) && arr.some((v) => want.has(Number(v)));
    });
  }

  const seriesIds = filtered.map((r) => r.id);
  const defaultByid = new Map<number, any>();
  if (seriesIds.length) {
    const plans = await prisma.testSeriesPrice.findMany({
      where: { testSeriesId: { in: seriesIds }, status: true },
      orderBy: [{ isDefault: "desc" }, { price: "asc" }],
    });
    for (const p of plans) {
      if (!defaultByid.has(p.testSeriesId)) defaultByid.set(p.testSeriesId, p);
    }
  }

  const catMap = await buildExamCategoryMap(filtered.map((r) => r.examCategoryIds));

  const data = filtered.map((r) => {
    const def = defaultByid.get(r.id);
    return {
      ...seriesDto(r, catMap),
      defaultPlan: def ? defaultPlanPreview(def) : null,
    };
  });

  // total reflects the catId filter when present (matches Mongo countDocuments).
  return { data, total: opts.catIds.length ? filtered.length : total };
};

/** Returns null when the series is missing (→ controller 404). */
export const getTestSeriesById = async (id: number) => {
  const series = await prisma.testSeries.findUnique({ where: { id } });
  if (!series) return null;

  const [contentCategories, prices, links] = await Promise.all([
    prisma.testSeriesContentCategory.findMany({
      where: { testSeriesId: id },
      orderBy: [{ orderBy: "asc" }, { name: "asc" }],
    }),
    prisma.testSeriesPrice.findMany({
      where: { testSeriesId: id },
      orderBy: [{ isDefault: "desc" }, { price: "asc" }],
    }),
    prisma.testSeriesExam.findMany({
      where: { testSeriesId: id },
      orderBy: [{ orderBy: "asc" }, { id: "asc" }],
    }),
  ]);

  const examMap = await buildExamMap(links.map((l) => l.examId));
  const catMap = await buildExamCategoryMap([series.examCategoryIds]);

  return {
    series: seriesDto(series, catMap),
    contentCategories: contentCategories.map(contentCategoryDto),
    prices: prices.map(priceDto),
    papers: links.map((l) => paperDto(l, examMap)),
  };
};

const buildExamMap = async (rawIds: (number | null)[]) => {
  const ids = [...new Set(rawIds.filter((v): v is number => v != null))];
  const map = new Map<number, any>();
  if (!ids.length) return map;
  const exams = await prisma.exam.findMany({ where: { id: { in: ids } } });
  for (const e of exams) map.set(e.id, examShortDto(e));
  return map;
};

export type SeriesWrite = {
  title?: string;
  description?: string;
  thumbnail?: string;
  examCategoryIds?: any[];
  examCategoryId?: any;
  language?: string;
  isFree?: boolean;
  instructions?: string;
  policy?: string;
  orderBy?: number;
  status?: boolean;
};

const mapSeriesWrite = (data: SeriesWrite): any => {
  const out: any = {};
  if (data.title !== undefined) out.title = data.title;
  if (data.description !== undefined) out.description = data.description;
  if (data.language !== undefined) out.language = data.language;
  if (data.isFree !== undefined) out.isFree = data.isFree;
  if (data.instructions !== undefined) out.instructions = data.instructions;
  if (data.policy !== undefined) out.policy = data.policy;
  if (data.orderBy !== undefined) out.orderBy = data.orderBy;
  if (data.status !== undefined) out.status = data.status;
  const cat = resolveCategoryWrite(data.examCategoryIds, data.examCategoryId);
  if (cat.examCategoryIds !== undefined) out.examCategoryIds = cat.examCategoryIds;
  if (cat.examCategoryId !== undefined) out.examCategoryId = cat.examCategoryId;
  return out;
};

export const createTestSeries = async (data: SeriesWrite) => {
  const set = mapSeriesWrite(data);
  // Empty-string thumbnail means "no thumbnail" — drop it (Mongo parity).
  if (data.thumbnail !== undefined && data.thumbnail !== "") set.thumbnail = data.thumbnail;
  const created = await prisma.testSeries.create({ data: set });
  const catMap = await buildExamCategoryMap([created.examCategoryIds]);
  return { series: seriesDto(created, catMap) };
};

/** Returns { notFound: true } when missing. */
export const getSeriesIsFree = async (id: number): Promise<{ isFree: boolean } | null> => {
  const row = await prisma.testSeries.findUnique({ where: { id }, select: { isFree: true } });
  return row ? { isFree: row.isFree } : null;
};

/** Paid series must have at least one active plan. Returns true if it does. */
export const hasActivePlan = async (testSeriesId: number): Promise<boolean> => {
  const found = await prisma.testSeriesPrice.findFirst({
    where: { testSeriesId, status: true },
    select: { id: true },
  });
  return !!found;
};

/** Returns null when the series is missing (→ controller 404). */
export const updateTestSeries = async (id: number, data: SeriesWrite) => {
  const set = mapSeriesWrite(data);
  // Empty-string thumbnail removes it; a present non-empty value sets it; a
  // missing thumbnail field leaves it unchanged.
  if (data.thumbnail === "") set.thumbnail = null;
  else if (data.thumbnail !== undefined) set.thumbnail = data.thumbnail;

  const updated = await prisma.testSeries.update({ where: { id }, data: set }).catch(() => null);
  if (!updated) return null;
  const catMap = await buildExamCategoryMap([updated.examCategoryIds]);
  return { series: seriesDto(updated, catMap) };
};

/** Count of active (verified, not-expired) subscriptions on this series. */
export const activeSubCount = async (testSeriesId: number, now: Date): Promise<number> =>
  prisma.testSeriesSubscription.count({
    where: { testSeriesId, status: true, endAt: { gt: now } },
  });

/** Cascade-delete the series and its children. Returns false when missing. */
export const deleteTestSeries = async (id: number): Promise<boolean> => {
  const exists = await prisma.testSeries.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.testSeriesExam.deleteMany({ where: { testSeriesId: id } });
  await prisma.testSeriesContentCategory.deleteMany({ where: { testSeriesId: id } });
  await prisma.testSeriesPrice.deleteMany({ where: { testSeriesId: id } });
  await prisma.testSeries.delete({ where: { id } });
  return true;
};

// ── Content categories ────────────────────────────────────────────────────────

export const seriesExists = async (id: number): Promise<boolean> =>
  !!(await prisma.testSeries.findUnique({ where: { id }, select: { id: true } }));

export const listContentCategories = async (testSeriesId: number) => {
  const rows = await prisma.testSeriesContentCategory.findMany({
    where: { testSeriesId },
    orderBy: [{ orderBy: "asc" }, { name: "asc" }],
  });
  const data = rows.map(contentCategoryDto);
  return { data, total: data.length };
};

export type ContentCategoryWrite = {
  name?: string;
  icon?: string;
  orderBy?: number;
  status?: boolean;
};

const mapCategoryWrite = (data: ContentCategoryWrite): any => {
  const out: any = {};
  if (data.name !== undefined) out.name = data.name;
  if (data.icon !== undefined) out.icon = data.icon;
  if (data.orderBy !== undefined) out.orderBy = data.orderBy;
  if (data.status !== undefined) out.status = data.status;
  return out;
};

export const createContentCategory = async (testSeriesId: number, data: ContentCategoryWrite) => {
  const cat = await prisma.testSeriesContentCategory.create({
    data: { ...mapCategoryWrite(data), testSeriesId },
  });
  return { category: contentCategoryDto(cat) };
};

/** Returns null when missing. */
export const updateContentCategory = async (id: number, data: ContentCategoryWrite) => {
  const cat = await prisma.testSeriesContentCategory
    .update({ where: { id }, data: mapCategoryWrite(data) })
    .catch(() => null);
  return cat ? { category: contentCategoryDto(cat) } : null;
};

/** Count of paper links referencing this content category. */
export const papersInCategory = async (contentCategoryId: number): Promise<number> =>
  prisma.testSeriesExam.count({ where: { contentCategoryId } });

/** Returns false when missing. */
export const deleteContentCategory = async (id: number): Promise<boolean> => {
  const exists = await prisma.testSeriesContentCategory.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!exists) return false;
  await prisma.testSeriesContentCategory.delete({ where: { id } });
  return true;
};

// ── Series ↔ Exam linking ─────────────────────────────────────────────────────

export const recomputePaperCount = async (testSeriesId: number): Promise<void> => {
  const count = await prisma.testSeriesExam.count({ where: { testSeriesId, status: true } });
  await prisma.testSeries.update({ where: { id: testSeriesId }, data: { paperCount: count } });
};

export const listPapers = async (testSeriesId: number) => {
  const links = await prisma.testSeriesExam.findMany({
    where: { testSeriesId },
    orderBy: [{ orderBy: "asc" }, { id: "asc" }],
  });
  const examMap = await buildExamMap(links.map((l) => l.examId));
  const catIds = [...new Set(links.map((l) => l.contentCategoryId))];
  const cats = catIds.length
    ? await prisma.testSeriesContentCategory.findMany({
        where: { id: { in: catIds } },
        select: { id: true, name: true },
      })
    : [];
  const catMap = new Map(cats.map((c) => [c.id, { _id: String(c.id), name: c.name }]));
  const data = links.map((l) => paperDto(l, examMap, catMap));
  return { data, total: data.length };
};

export const contentCategoryBelongsTo = async (
  contentCategoryId: number,
  testSeriesId: number
): Promise<boolean> =>
  !!(await prisma.testSeriesContentCategory.findFirst({
    where: { id: contentCategoryId, testSeriesId },
    select: { id: true },
  }));

export const examExists = async (examId: number): Promise<boolean> =>
  !!(await prisma.exam.findUnique({ where: { id: examId }, select: { id: true } }));

export type LinkPaperWrite = {
  contentCategoryId: number;
  examId: number;
  orderBy?: number;
  status?: boolean;
};

/** Returns { duplicate: true } on the UNIQUE(test_series_id,exam_id) clash. */
export const linkPaper = async (
  testSeriesId: number,
  data: LinkPaperWrite
): Promise<{ paper: any } | { duplicate: true }> => {
  const dup = await prisma.testSeriesExam.findFirst({
    where: { testSeriesId, examId: data.examId },
    select: { id: true },
  });
  if (dup) return { duplicate: true };
  const row = await prisma.testSeriesExam.create({
    data: {
      testSeriesId,
      contentCategoryId: data.contentCategoryId,
      examId: data.examId,
      ...(data.orderBy !== undefined ? { orderBy: data.orderBy } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
    },
  });
  await recomputePaperCount(testSeriesId);
  return { paper: paperDto(row) };
};

export const getPaperLink = async (linkId: number) =>
  prisma.testSeriesExam.findUnique({ where: { id: linkId } });

export type UpdateLinkWrite = {
  contentCategoryId?: number;
  orderBy?: number;
  status?: boolean;
};

export const updatePaperLink = async (linkId: number, data: UpdateLinkWrite) => {
  const set: any = {};
  if (data.contentCategoryId !== undefined) set.contentCategoryId = data.contentCategoryId;
  if (data.orderBy !== undefined) set.orderBy = data.orderBy;
  if (data.status !== undefined) set.status = data.status;
  const row = await prisma.testSeriesExam.update({ where: { id: linkId }, data: set });
  await recomputePaperCount(row.testSeriesId);
  return { paper: paperDto(row) };
};

/** Returns the freed series id, or null when the link was missing. */
export const unlinkPaper = async (linkId: number): Promise<number | null> => {
  const row = await prisma.testSeriesExam.findUnique({ where: { id: linkId } });
  if (!row) return null;
  await prisma.testSeriesExam.delete({ where: { id: linkId } });
  await recomputePaperCount(row.testSeriesId);
  return row.testSeriesId;
};

// ── Prices ────────────────────────────────────────────────────────────────────

export const listPrices = async (testSeriesId: number) => {
  const rows = await prisma.testSeriesPrice.findMany({
    where: { testSeriesId },
    orderBy: [{ isDefault: "desc" }, { price: "asc" }, { createdAt: "asc" }],
  });
  const data = rows.map(priceDto);
  return { data, total: data.length };
};

export type PriceWrite = {
  name?: string;
  durationDays?: number;
  price?: number;
  originalPrice?: number;
  isDefault?: boolean;
  status?: boolean;
};

export const createPrice = async (testSeriesId: number, data: PriceWrite) => {
  const price = await prisma.$transaction(async (tx) => {
    if (data.isDefault) {
      await tx.testSeriesPrice.updateMany({
        where: { testSeriesId, isDefault: true },
        data: { isDefault: false },
      });
    }
    return tx.testSeriesPrice.create({
      data: {
        testSeriesId,
        name: data.name ?? null,
        durationDays: data.durationDays as number,
        price: data.price as number,
        ...(data.originalPrice !== undefined ? { originalPrice: data.originalPrice } : {}),
        ...(data.isDefault !== undefined ? { isDefault: data.isDefault } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
      },
    });
  });
  return { price: priceDto(price) };
};

/** Returns null when the price is missing. */
export const updatePrice = async (priceId: number, data: PriceWrite) => {
  const price = await prisma.$transaction(async (tx) => {
    const existing = await tx.testSeriesPrice.findUnique({ where: { id: priceId } });
    if (!existing) return null;
    if (data.isDefault === true) {
      await tx.testSeriesPrice.updateMany({
        where: { testSeriesId: existing.testSeriesId, isDefault: true, id: { not: priceId } },
        data: { isDefault: false },
      });
    }
    const set: any = {};
    if (data.name !== undefined) set.name = data.name;
    if (data.durationDays !== undefined) set.durationDays = data.durationDays;
    if (data.price !== undefined) set.price = data.price;
    if (data.originalPrice !== undefined) set.originalPrice = data.originalPrice;
    if (data.isDefault !== undefined) set.isDefault = data.isDefault;
    if (data.status !== undefined) set.status = data.status;
    return tx.testSeriesPrice.update({ where: { id: priceId }, data: set });
  });
  return price ? { price: priceDto(price) } : null;
};

/** Active subscriptions referencing this plan. */
export const activeSubsForPlan = async (planId: number, now: Date): Promise<number> =>
  prisma.testSeriesSubscription.count({
    where: { planId, status: true, endAt: { gt: now } },
  });

/** Returns false when the price is missing. */
export const deletePrice = async (priceId: number): Promise<boolean> => {
  const exists = await prisma.testSeriesPrice.findUnique({
    where: { id: priceId },
    select: { id: true },
  });
  if (!exists) return false;
  await prisma.testSeriesPrice.delete({ where: { id: priceId } });
  return true;
};

// ── Subscriptions / Orders ────────────────────────────────────────────────────

export type ListSubsOpts = {
  testSeriesId: number | null;
  customerId: number | null;
  status: boolean | null;
  page: number;
  limit: number;
};

const customerShortDto = (c: any) =>
  c
    ? {
        _id: String(c.id),
        name: c.fullName ?? null,
        phone: c.phoneNumber ?? null,
        email: c.emailAddress ?? null,
      }
    : null;

export const listSubscriptions = async (opts: ListSubsOpts) => {
  const where: any = {};
  if (opts.testSeriesId != null) where.testSeriesId = opts.testSeriesId;
  if (opts.customerId != null) where.customerId = opts.customerId;
  if (opts.status !== null) where.status = opts.status;

  const [rows, total] = await Promise.all([
    prisma.testSeriesSubscription.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.testSeriesSubscription.count({ where }),
  ]);

  const seriesIds = [...new Set(rows.map((r) => r.testSeriesId).filter((v): v is number => v != null))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is number => v != null))];
  const [seriesRows, customerRows] = await Promise.all([
    seriesIds.length
      ? prisma.testSeries.findMany({ where: { id: { in: seriesIds } }, select: { id: true, title: true } })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, fullName: true, phoneNumber: true, emailAddress: true },
        })
      : [],
  ]);
  const seriesById = new Map(seriesRows.map((t) => [t.id, { _id: String(t.id), title: t.title }]));
  const custById = new Map(customerRows.map((c) => [c.id, c]));

  const data = rows.map((s) => ({
    ...subscriptionDto(s),
    testSeriesId: s.testSeriesId != null ? seriesById.get(s.testSeriesId) ?? null : null,
    customerId: s.customerId != null ? customerShortDto(custById.get(s.customerId)) : null,
  }));

  return { data, total };
};

export type GrantWrite = {
  customerId: number;
  planId: number | null;
  durationDays?: number;
  price?: number;
  startAt?: string;
  remarks?: string;
};

/** Returns { planNotFound: true } | { missingDuration: true } | { subscription }. */
export const grantSubscription = async (
  testSeriesId: number,
  data: GrantWrite
): Promise<{ planNotFound: true } | { missingDuration: true } | { subscription: any }> => {
  let durationDays = data.durationDays;
  let price = data.price ?? 0;
  if (data.planId != null) {
    const plan = await prisma.testSeriesPrice.findUnique({ where: { id: data.planId } });
    if (!plan) return { planNotFound: true };
    durationDays = durationDays ?? plan.durationDays;
    price = data.price ?? num(plan.price);
  }
  if (!durationDays || durationDays <= 0) return { missingDuration: true };

  const startAt = data.startAt ? new Date(data.startAt) : new Date();
  const endAt = new Date(startAt);
  endAt.setDate(endAt.getDate() + durationDays);

  const sub = await prisma.testSeriesSubscription.create({
    data: {
      customerId: data.customerId,
      testSeriesId,
      planId: data.planId ?? null,
      price,
      startAt,
      endAt,
      paymentType: "backend", // PackageCourseEbookPaymentType.BACKEND
      remarks: data.remarks ?? null,
      status: true,
    },
  });
  return { subscription: subscriptionDto(sub) };
};

export type UpdateSubWrite = {
  endAt?: string;
  status?: boolean;
  remarks?: string;
};

/** Returns null when missing. */
export const updateSubscription = async (id: number, data: UpdateSubWrite) => {
  const set: any = {};
  if (data.endAt) set.endAt = new Date(data.endAt);
  if (typeof data.status === "boolean") set.status = data.status;
  if (typeof data.remarks === "string") set.remarks = data.remarks;
  const sub = await prisma.testSeriesSubscription.update({ where: { id }, data: set }).catch(() => null);
  return sub ? { subscription: subscriptionDto(sub) } : null;
};

/** Returns false when missing. */
export const deleteSubscription = async (id: number): Promise<boolean> => {
  const exists = await prisma.testSeriesSubscription.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.testSeriesSubscription.delete({ where: { id } });
  return true;
};

export type ListOrdersOpts = {
  testSeriesId: number | null;
  customerId: number | null;
  status: string | null;
  page: number;
  limit: number;
};

const orderDto = (o: any) => ({
  _id: String(o.id),
  customerId: o.customerId != null ? String(o.customerId) : null,
  testSeriesId: o.testSeriesId != null ? String(o.testSeriesId) : null,
  planId: o.planId != null ? String(o.planId) : null,
  paymentMethod: o.paymentMethod,
  orderType: o.orderType,
  orderPrice: num(o.orderPrice),
  basePrice: num(o.basePrice),
  discountAmount: num(o.discountAmount),
  gstAmount: num(o.gstAmount),
  handlingFee: num(o.handlingFee),
  promocodeId: o.promocodeId != null ? String(o.promocodeId) : null,
  razorpayOrderId: o.razorpayOrderId ?? null,
  razorpayPaymentId: o.razorpayPaymentId ?? null,
  ipAddress: o.ipAddress ?? null,
  transactionId: o.transactionId ?? null,
  status: o.status,
  createdAt: o.createdAt ?? null,
  updatedAt: o.updatedAt ?? null,
});

export const listOrders = async (opts: ListOrdersOpts) => {
  const where: any = {};
  if (opts.testSeriesId != null) where.testSeriesId = opts.testSeriesId;
  if (opts.customerId != null) where.customerId = opts.customerId;
  if (opts.status) where.status = opts.status;

  const [rows, total] = await Promise.all([
    prisma.testSeriesOrder.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.testSeriesOrder.count({ where }),
  ]);

  const seriesIds = [...new Set(rows.map((r) => r.testSeriesId).filter((v): v is number => v != null))];
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((v): v is number => v != null))];
  const [seriesRows, customerRows] = await Promise.all([
    seriesIds.length
      ? prisma.testSeries.findMany({ where: { id: { in: seriesIds } }, select: { id: true, title: true } })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, fullName: true, phoneNumber: true, emailAddress: true },
        })
      : [],
  ]);
  const seriesById = new Map(seriesRows.map((t) => [t.id, { _id: String(t.id), title: t.title }]));
  const custById = new Map(customerRows.map((c) => [c.id, c]));

  const data = rows.map((o) => ({
    ...orderDto(o),
    testSeriesId: o.testSeriesId != null ? seriesById.get(o.testSeriesId) ?? null : null,
    customerId: o.customerId != null ? customerShortDto(custById.get(o.customerId)) : null,
  }));

  return { data, total };
};
