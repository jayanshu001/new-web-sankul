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
import ExcelJS from "exceljs";
import { nextOrder } from "../../utils/listOrdering";
import { PassThrough } from "node:stream";
import { buildCsvFromRowBatches } from "../../utils/csvExport";
import { buildPrismaSearch } from "../../utils/searchFilter";
import type { ReportSource } from "../../utils/reportStream";
import { prisma } from "../../config/prisma";
import { andWhere, statusWhere, normalizeStatus, reportRow } from "../../utils/reportFilters";
import { buildPagination } from "../../utils/listQuery";
import { splitFullName } from "../customer-profile/customer-profile.name";

export const ADMIN_TESTSERIES_MODULE = "admin-testseries";
export const isAdminTestSeriesMysql = (): boolean => true;

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
  // "Most Popular" badge — computed, read-only. Parity with the course/package/
  // ebook/live-course plan DTOs. No manual override exists (removed 2026-08-05 —
  // see docs/admin/MOST_POPULAR_PLAN_PIN.md).
  isMostPopular: p.isMostPopular ?? false,
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
  const search = buildPrismaSearch(opts.search, ["title"]);
  if (search) Object.assign(where, search);
  if (opts.status !== null) where.status = opts.status;

  const [rows, total] = await Promise.all([
    prisma.testSeries.findMany({
      where,
      // Recently-added on top (utils/listOrdering); id (autoincrement) is a
      // deterministic tiebreaker for null/duplicate createdAt (migrated rows).
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
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
      orderBy: [{ orderBy: "asc" }, { name: "asc" }, { id: "asc" }],
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

export const createTestSeries = async (data: SeriesWrite, now: Date = new Date()) => {
  const set = mapSeriesWrite(data);
  // Empty-string thumbnail means "no thumbnail" — drop it (Mongo parity).
  if (data.thumbnail !== undefined && data.thumbnail !== "") set.thumbnail = data.thumbnail;
  // created_at/updated_at have no DB default and no ON UPDATE on this introspected
  // legacy table, and the model declares neither @default(now()) nor @updatedAt — so
  // unless set here the row reads back null and is invisible to created_at-windowed
  // reads (admin dashboard) + sorts unpredictably. Same hazard as ws_test_series_order.
  set.createdAt = now;
  set.updatedAt = now;
  // No explicit order → previous row + 1 (see utils/listOrdering).
  if (set.orderBy === undefined || set.orderBy === null) {
    set.orderBy = nextOrder((await prisma.testSeries.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderBy: true } }))?.orderBy);
  }
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
export const updateTestSeries = async (id: number, data: SeriesWrite, now: Date = new Date()) => {
  const set = mapSeriesWrite(data);
  // Empty-string thumbnail removes it; a present non-empty value sets it; a
  // missing thumbnail field leaves it unchanged.
  if (data.thumbnail === "") set.thumbnail = null;
  else if (data.thumbnail !== undefined) set.thumbnail = data.thumbnail;
  // No @updatedAt on the model / no ON UPDATE on the column — set it explicitly.
  set.updatedAt = now;

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

export const listContentCategories = async (
  testSeriesId: number,
  opts: { skip: number; take: number; page: number; limit: number }
) => {
  const [rows, total] = await Promise.all([
    prisma.testSeriesContentCategory.findMany({
      where: { testSeriesId },
      orderBy: [{ orderBy: "asc" }, { name: "asc" }, { id: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.testSeriesContentCategory.count({ where: { testSeriesId } }),
  ]);
  const data = rows.map(contentCategoryDto);
  return { data, pagination: buildPagination(total, opts.page, opts.limit) };
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
  const mapped = mapCategoryWrite(data);
  // No explicit order → previous row + 1 WITHIN this series (that is how the tab lists them).
  if (mapped.orderBy === undefined || mapped.orderBy === null) {
    mapped.orderBy = nextOrder(
      (await prisma.testSeriesContentCategory.findFirst({ where: { testSeriesId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderBy: true } }))?.orderBy,
    );
  }
  const cat = await prisma.testSeriesContentCategory.create({
    data: { ...mapped, testSeriesId },
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

export const listPapers = async (
  testSeriesId: number,
  opts: { search?: string; skip: number; take: number; page: number; limit: number }
) => {
  // The searchable paper display-name is NOT a DB column — it is derived by
  // hydrating each link's examId through buildExamMap. So we cannot filter or
  // paginate `name` at the DB level. Fetch ALL links for the series (paper
  // counts per series are small), hydrate names, then filter/slice in memory.
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
  let all = links.map((l) => paperDto(l, examMap, catMap));
  if (opts.search) {
    // Paper display-name is the hydrated exam title (paperDto sets
    // `examId` to the exam DTO { _id, title, ... } when hydrated; falls back
    // to the id string otherwise). Match case-insensitively against it.
    const needle = opts.search.toLowerCase();
    all = all.filter((p) => {
      const nm = typeof p.examId === "object" && p.examId ? (p.examId as any).title : p.examId;
      return String(nm ?? "").toLowerCase().includes(needle);
    });
  }
  const total = all.length;
  const data = all.slice(opts.skip, opts.skip + opts.take);
  return { data, pagination: buildPagination(total, opts.page, opts.limit) };
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
      // No explicit order → previous row + 1 WITHIN this series.
      orderBy: data.orderBy ?? nextOrder(
        (await prisma.testSeriesExam.findFirst({ where: { testSeriesId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { orderBy: true } }))?.orderBy,
      ),
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

export const listPrices = async (
  testSeriesId: number,
  opts: { skip: number; take: number; page: number; limit: number }
) => {
  const [rows, total] = await Promise.all([
    prisma.testSeriesPrice.findMany({
      where: { testSeriesId },
      orderBy: [{ isDefault: "desc" }, { price: "asc" }, { createdAt: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),
    prisma.testSeriesPrice.count({ where: { testSeriesId } }),
  ]);
  const data = rows.map(priceDto);
  return { data, pagination: buildPagination(total, opts.page, opts.limit) };
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

// ── subscription list (Reports contract) ──────────────────────────────────────
// Shared contract across the 4 admin subscription reports — see
// docs/REPORTS_SUBSCRIPTIONS_ADMIN.md. Returns { summary, data, pagination };
// summary respects all filters but ignores pagination. `status` here is the
// normalized active|expired|inactive (not the raw boolean); paymentMethod is the
// coarse online|backend (= paymentType on this table; no order join needed).
export type ListSubsOpts = {
  testSeriesId: number | null;
  customerId: number | null;
  status?: string;
  paymentMethod?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  sortBy?: string;
  sortOrder?: string;
  page: number;
  limit: number;
};

// Search id-resolvers (id-set → OR { in }), mirroring admin-subscription.repository.
const customerIdsByText = async (q: string): Promise<number[]> =>
  (
    await prisma.customer.findMany({
      where: buildPrismaSearch(q, ["fullName", "phoneNumber", "emailAddress"]) ?? {},
      select: { id: true },
    })
  ).map((r) => r.id);

const testSeriesIdsByText = async (q: string): Promise<number[]> =>
  (await prisma.testSeries.findMany({ where: buildPrismaSearch(q, ["title"]) ?? {}, select: { id: true } })).map((r) => r.id);

const SUB_SORT_FIELDS: Record<string, "createdAt" | "startAt" | "endAt" | "price"> = {
  createdAt: "createdAt",
  startAt: "startAt",
  endAt: "endAt",
  price: "price",
  amount: "price",
};

// Shared subscription filter/query params for the list + its CSV/Excel exports
// (page/limit only apply to the paginated list).
export type SubReportOpts = Omit<ListSubsOpts, "page" | "limit">;

// Bare "YYYY-MM-DD" → inclusive IST day edge (from → 00:00:00.000, to →
// 23:59:59.999 at Asia/Kolkata, +05:30); full timestamps pass through. Mirrors the
// Subscription report so the created-at filter honors IST day boundaries (a naive
// UTC parse would drop the last 5.5h of the day). Invalid → undefined (no bound).
const parseDayBoundIst = (v: string | undefined, end: boolean): Date | undefined => {
  if (!v) return undefined;
  const s = v.trim();
  const d = /^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T${end ? "23:59:59.999" : "00:00:00.000"}+05:30`) : new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};
// Date-range filter bounds `createdAt` (records created between X and Y) at IST edges.
const istCreatedWhere = (dateFrom?: string, dateTo?: string): Record<string, any> => {
  const gte = parseDayBoundIst(dateFrom, false);
  const lte = parseDayBoundIst(dateTo, true);
  if (!gte && !lte) return {};
  const createdAt: any = {};
  if (gte) createdAt.gte = gte;
  if (lte) createdAt.lte = lte;
  return { createdAt };
};

// Shared where-fragment builder for the list + exports. Returns null when a
// search matched nothing (force an empty result, mirroring the list contract).
const buildSubsWhere = async (opts: SubReportOpts, now: Date): Promise<Record<string, any> | null> => {
  const base: any = {};
  if (opts.testSeriesId != null) base.testSeriesId = opts.testSeriesId;
  if (opts.customerId != null) base.customerId = opts.customerId;
  if (opts.paymentMethod === "online" || opts.paymentMethod === "backend") base.paymentType = opts.paymentMethod;
  const dw = istCreatedWhere(opts.dateFrom, opts.dateTo);

  let searchWhere: Record<string, any> | undefined;
  if (opts.search) {
    const [customerIdsIn, seriesIdsIn] = await Promise.all([
      customerIdsByText(opts.search),
      testSeriesIdsByText(opts.search),
    ]);
    if (!customerIdsIn.length && !seriesIdsIn.length) return null;
    const or: any[] = [];
    if (customerIdsIn.length) or.push({ customerId: { in: customerIdsIn } });
    if (seriesIdsIn.length) or.push({ testSeriesId: { in: seriesIdsIn } });
    searchWhere = { OR: or };
  }

  // andWhere combines the OR-bearing search + status fragments safely.
  const baseWhere = andWhere(base, dw, searchWhere);
  return andWhere(baseWhere, statusWhere(opts.status, now));
};

const subSortSpec = (opts: SubReportOpts) => ({
  sortField: SUB_SORT_FIELDS[opts.sortBy ?? ""] ?? "createdAt",
  sortDir: (opts.sortOrder === "asc" ? "asc" : "desc") as "asc" | "desc",
});

// Enrich raw subscription rows into the canonical Reports DTO — mirrors the
// Subscription report row shape (admin-subscription hydrateCourseSubRows) so the
// shared MergedSubscriptionReport component + the CSV/Excel columns line up. Fields
// with no SQL source on test series are surfaced as null (they render blank): test
// series has no promoter attribution (no promoter_id), no activated-by (no created_by),
// no educator link, no ws_coin, and no material/course split or shipping — see
// docs/backend-requests/test-series-report-enrich-columns.md.
const blankToNull = (v: string | null | undefined): string | null => (v ? v : null);
const enrichSubRows = async (rows: any[], now: Date) => {
  const uniq = (xs: (number | null | undefined)[]) => [...new Set(xs.filter((v): v is number => v != null))];
  const seriesIds = uniq(rows.map((r) => r.testSeriesId));
  const customerIds = uniq(rows.map((r) => r.customerId));
  const planIds = uniq(rows.map((r) => r.planId));
  const orderIds = uniq(rows.map((r) => r.orderId));
  const promocodeIds = uniq(rows.map((r) => r.promocodeId));
  const [seriesRows, customerRows, planRows, orderRows, promoRows] = await Promise.all([
    seriesIds.length
      ? prisma.testSeries.findMany({ where: { id: { in: seriesIds } }, select: { id: true, title: true, thumbnail: true } })
      : [],
    customerIds.length
      ? prisma.customer.findMany({
          where: { id: { in: customerIds } },
          select: { id: true, fullName: true, phoneNumber: true, emailAddress: true },
        })
      : [],
    planIds.length
      ? prisma.testSeriesPrice.findMany({
          where: { id: { in: planIds } },
          select: { id: true, name: true, durationDays: true, price: true },
        })
      : [],
    // Order relation → Order Method (gateway), gateway order/payment ids, and the
    // bank reference (the grant path stores bankTransactionId in `transaction_id`).
    orderIds.length
      ? prisma.testSeriesOrder.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, paymentMethod: true, razorpayOrderId: true, razorpayPaymentId: true, transactionId: true },
        })
      : [],
    // Promocode is a direct FK on the subscription row (unlike the subscription
    // report's JSON snapshot) → resolve id → code string.
    promocodeIds.length
      ? prisma.promocode.findMany({ where: { id: { in: promocodeIds } }, select: { id: true, promocode: true } })
      : [],
  ]);
  const seriesById = new Map(seriesRows.map((t) => [t.id, t]));
  const custById = new Map(customerRows.map((c) => [c.id, c]));
  const planById = new Map(planRows.map((p) => [p.id, p]));
  const orderById = new Map(orderRows.map((o) => [o.id, o]));
  const promoById = new Map(promoRows.map((p) => [p.id, p]));

  return rows.map((r) => {
    const series = r.testSeriesId != null ? seriesById.get(r.testSeriesId) : null;
    const plan = r.planId != null ? planById.get(r.planId) : null;
    const order = r.orderId != null ? orderById.get(r.orderId) : null;
    const promo = r.promocodeId != null ? promoById.get(r.promocodeId) : null;
    const product = series
      ? { _id: String(series.id), type: "testSeries" as const, name: series.title ?? null, image: series.thumbnail ?? null }
      : null;
    const base = reportRow({
      cust: r.customerId != null ? custById.get(r.customerId) : undefined,
      product,
      plan: plan ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.durationDays ?? null, price: num(plan.price) } : null,
      amount: num(r.price),
      paymentMethod: r.paymentType === "backend" ? "backend" : "online",
      status: normalizeStatus({ status: r.status, endAt: r.endAt }, now),
      startAt: r.startAt ?? null,
      endAt: r.endAt ?? null,
      createdAt: r.createdAt ?? null,
    });
    return {
      id: r.id,
      ...base,
      // Gateway from the linked order (razorpay|bank|cash|…), lowercased; null if none.
      orderMethod: order?.paymentMethod ? String(order.paymentMethod).toLowerCase() : null,
      razorpayOrderId: blankToNull(order?.razorpayOrderId),
      razorpayPaymentId: blankToNull(order?.razorpayPaymentId),
      bankTransactionId: blankToNull(order?.transactionId),
      promocode: promo?.promocode ?? null,
      promocodeId: r.promocodeId ?? null,
      remarks: r.remarks ?? null,
      // No SQL source on test series → null (render blank).
      promoterName: null as string | null,
      promoterId: null as number | null,
      educatorName: null as string | null,
      educatorId: null as number | null,
      activatedBy: null as string | null,
      wsCoin: null as number | null,
      // N/A for test series (digital, no material/course split).
      courseAmount: null as number | null,
      materialAmount: null as number | null,
      materialType: null as string | null,
      trackingId: null as number | null,
      shipping: null as null,
    };
  });
};

export const listSubscriptions = async (opts: ListSubsOpts) => {
  const now = new Date();
  const listWhere = await buildSubsWhere(opts, now);
  if (listWhere === null) {
    return {
      summary: { totalCount: 0, totalRevenue: 0, activeCount: 0, expiredCount: 0 },
      data: [] as any[],
      pagination: { total: 0, page: opts.page, limit: opts.limit, totalPages: 0 },
    };
  }
  const { sortField, sortDir } = subSortSpec(opts);

  const [rows, agg, activeCount, expiredCount] = await Promise.all([
    prisma.testSeriesSubscription.findMany({
      where: listWhere,
      orderBy: { [sortField]: sortDir },
      skip: (opts.page - 1) * opts.limit,
      take: opts.limit,
    }),
    prisma.testSeriesSubscription.aggregate({ where: listWhere, _count: { _all: true }, _sum: { price: true } }),
    prisma.testSeriesSubscription.count({ where: andWhere(listWhere, statusWhere("active", now)) }),
    prisma.testSeriesSubscription.count({ where: andWhere(listWhere, statusWhere("expired", now)) }),
  ]);
  const total = agg._count._all;
  const data = await enrichSubRows(rows, now);

  return {
    summary: { totalCount: total, totalRevenue: num(agg._sum.price ?? 0), activeCount, expiredCount },
    data,
    pagination: { total, page: opts.page, limit: opts.limit, totalPages: Math.ceil(total / opts.limit) },
  };
};

// ── subscription report exports (CSV / Excel) ─────────────────────────────────
// Entire filtered set (no pagination) and NO row cap — matches the Subscription
// export. Paged in keyset batches (id DESC, no deep OFFSET) and enriched per batch
// so memory stays bounded; both formats + the async job share one column spec.
const TS_SUB_EXPORT_BATCH = 5000;

async function* iterateSubExportRows(opts: SubReportOpts, now: Date) {
  const listWhere = await buildSubsWhere(opts, now);
  if (listWhere === null) return;
  let beforeId: number | undefined;
  for (;;) {
    const where = beforeId ? andWhere(listWhere, { id: { lt: beforeId } }) : listWhere;
    const rows = await prisma.testSeriesSubscription.findMany({ where, orderBy: { id: "desc" }, take: TS_SUB_EXPORT_BATCH });
    if (!rows.length) break;
    yield await enrichSubRows(rows, now);
    if (rows.length < TS_SUB_EXPORT_BATCH) break;
    beforeId = rows[rows.length - 1].id;
  }
}

// IST (Asia/Kolkata, +5:30, no DST) `YYYY-MM-DD HH:mm:ss`, e.g. "2026-10-06 00:01:21"
// — same format as the Subscription export (was a raw UTC ISO string).
const IST_OFFSET_MS = 330 * 60_000;
const pad2 = (n: number): string => String(n).padStart(2, "0");
const fmtExportDate = (d: Date | string | null | undefined): string => {
  if (!d) return "";
  const t = new Date(d);
  if (Number.isNaN(t.getTime())) return "";
  const s = new Date(t.getTime() + IST_OFFSET_MS);
  return `${s.getUTCFullYear()}-${pad2(s.getUTCMonth() + 1)}-${pad2(s.getUTCDate())} ${pad2(s.getUTCHours())}:${pad2(s.getUTCMinutes())}:${pad2(s.getUTCSeconds())}`;
};

// Column set follows the Subscription export order so the reports line up, minus the
// columns that don't apply to a digital test series and were dropped per FE request:
// Address/City/Pincode, Material Type, Course/Material Amount, plus the four with no
// test-series data source (Promoter Name, Educator Name, WS Coin, Activated By) — the
// FE hides all of these on the Test Series screen, so the export matches. Test series
// is a course-type product, so its name sits in "Course Name" (mirrors the FE
// productCell for testSeries); Package Name + Alternate Phone stay (blank) for now.
const TS_SUB_EXPORT_COLUMNS: { header: string; get: (r: any) => string | number }[] = [
  { header: "Created At", get: (r) => fmtExportDate(r.createdAt) },
  { header: "Order Method", get: (r) => r.orderMethod ?? "" },
  { header: "Customer Name", get: (r) => r.customer?.name ?? "" },
  { header: "Email", get: (r) => r.customer?.email ?? "" },
  { header: "Phone", get: (r) => r.customer?.phone ?? "" },
  { header: "Alternate Phone", get: () => "" },
  { header: "Package Name", get: () => "" },
  { header: "Course Name", get: (r) => r.product?.name ?? "" },
  { header: "Plan", get: (r) => r.plan?.name ?? "" },
  { header: "Start At", get: (r) => fmtExportDate(r.startAt) },
  { header: "End At", get: (r) => fmtExportDate(r.endAt) },
  { header: "Status", get: (r) => r.status ?? "" },
  { header: "Activation Type", get: (r) => r.paymentMethod ?? "" },
  { header: "Promocode", get: (r) => r.promocode ?? "" },
  { header: "Remarks", get: (r) => r.remarks ?? "" },
  { header: "Payment Id", get: (r) => r.razorpayPaymentId ?? "" },
  { header: "Order ID", get: (r) => r.razorpayOrderId ?? "" },
  { header: "Bank Transaction Id", get: (r) => r.bankTransactionId ?? "" },
  { header: "Amount", get: (r) => r.amount ?? "" },
  { header: "Activated By", get: (r) => r.activatedBy ?? "" },
];

export const buildSubscriptionsCsv = async (opts: SubReportOpts): Promise<string> => {
  const now = new Date();
  async function* rowBatches() {
    for await (const batch of iterateSubExportRows(opts, now)) {
      yield batch.map((r) => TS_SUB_EXPORT_COLUMNS.map((c) => c.get(r)));
    }
  }
  return buildCsvFromRowBatches(TS_SUB_EXPORT_COLUMNS.map((c) => c.header), rowBatches());
};

export const buildSubscriptionsXlsx = async (opts: SubReportOpts): Promise<Buffer> => {
  const now = new Date();
  const pass = new PassThrough();
  const chunks: Buffer[] = [];
  pass.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
  const finished = new Promise<void>((resolve, reject) => {
    pass.once("end", resolve);
    pass.once("error", reject);
  });
  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: pass, useStyles: false, useSharedStrings: false });
  const ws = wb.addWorksheet("Test Series Subscriptions");
  ws.columns = TS_SUB_EXPORT_COLUMNS.map((c) => ({ header: c.header, key: c.header, width: 22 }));
  for await (const batch of iterateSubExportRows(opts, now)) {
    for (const r of batch) ws.addRow(TS_SUB_EXPORT_COLUMNS.map((c) => c.get(r))).commit();
  }
  ws.commit();
  await wb.commit();
  await finished;
  return Buffer.concat(chunks);
};

// Streamed export source (async job path) — same rows/columns as the sync builders.
export function tsSubExportSource(opts: SubReportOpts): ReportSource {
  const now = new Date();
  return {
    worksheetName: "Test Series Subscriptions",
    headers: TS_SUB_EXPORT_COLUMNS.map((c) => c.header),
    rowBatches: (async function* () {
      for await (const batch of iterateSubExportRows(opts, now)) {
        yield batch.map((r) => TS_SUB_EXPORT_COLUMNS.map((c) => c.get(r)));
      }
    })(),
  };
}

export type GrantWrite = {
  customerId: number;
  planId: number | null;
  durationDays?: number;
  price?: number;
  startAt?: string;
  remarks?: string;
  // Standardized payment section — persisted on the linked ws_test_series_order row.
  paymentMethod?: string;
  bankTransactionId?: string | null;
  razorpayOrderId?: string | null;
  razorpayPaymentId?: string | null;
  // extend=true → top up the customer's existing active subscription for this test
  // series instead of creating a fresh row (falls back to create if none).
  extend?: boolean;
  // Acting admin id (resolved server-side from the JWT) → audit columns.
  actingAdminId?: number | null;
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

  const now = new Date();
  const startAt = data.startAt ? new Date(data.startAt) : now;

  // Record an order row carrying the granular payment method + reference ids +
  // amount, then link it via the subscription's order_id (matches the report /
  // paid-purchase shape where payment data lives on ws_test_series_order). Written
  // for both fresh grants and extends — an extend is still a paid transaction.
  const { subscription: sub } = await prisma.$transaction(async (tx) => {
    const order = await tx.testSeriesOrder.create({
      data: {
        customerId: data.customerId,
        testSeriesId,
        planId: data.planId ?? null,
        paymentMethod: data.paymentMethod ?? "cash",
        orderType: "purchase",
        orderPrice: price,
        razorpayOrderId: data.razorpayOrderId ?? null,
        razorpayPaymentId: data.razorpayPaymentId ?? null,
        transactionId: data.bankTransactionId ?? null,
        status: "complete",
        createdAt: now,
        updatedAt: now,
      },
    });

    // Subscription Type = Extend: append the plan's duration onto the customer's
    // existing active subscription; fall back to a fresh row when none exists.
    const existing = data.extend
      ? await tx.testSeriesSubscription.findFirst({
          where: { customerId: data.customerId, testSeriesId, status: true, endAt: { gte: now } },
          orderBy: { endAt: "desc" },
        })
      : null;

    if (existing) {
      const base = existing.endAt && existing.endAt > now ? new Date(existing.endAt) : new Date(now);
      base.setDate(base.getDate() + durationDays!);
      const subscription = await tx.testSeriesSubscription.update({
        where: { id: existing.id },
        data: {
          orderId: order.id,
          planId: data.planId ?? existing.planId,
          // `price` is deliberately NOT written on extend. It records what the
          // customer paid for this subscription; a free "Add Days" would zero it
          // (₹699 → ₹0, unrecoverable — updateSubscriptionSchema cannot set it
          // back). Note the admin panel sends an explicit `price: 0` on extend, so
          // a `?? existing.price` guard would NOT be enough — 0 is not nullish.
          // Ignoring it outright is what lets the shipped frontend stay unchanged.
          // The ORDER row still records the request amount (0 for a free extend),
          // which is what distinguishes an admin grant from a paid renewal.
          endAt: base,
          ...(data.remarks !== undefined ? { remarks: data.remarks } : {}),
          // Extend = admin edit of an existing row → stamp updated_by only.
          ...(data.actingAdminId != null ? { updated_by: data.actingAdminId } : {}),
          updatedAt: now,
        },
      });
      return { subscription };
    }

    const endAt = new Date(startAt);
    endAt.setDate(endAt.getDate() + durationDays!);
    const subscription = await tx.testSeriesSubscription.create({
      data: {
        orderId: order.id,
        customerId: data.customerId,
        testSeriesId,
        planId: data.planId ?? null,
        price,
        startAt,
        endAt,
        paymentType: "backend", // PackageCourseEbookPaymentType.BACKEND
        remarks: data.remarks ?? null,
        status: true,
        // Admin-initiated manual grant → both audit columns = the acting admin.
        created_by: data.actingAdminId ?? null,
        updated_by: data.actingAdminId ?? null,
      },
    });
    return { subscription };
  });
  return { subscription: subscriptionDto(sub) };
};

export type UpdateSubWrite = {
  endAt?: string;
  status?: boolean;
  remarks?: string;
  // Acting admin id (resolved server-side from the JWT) → updated_by.
  actingAdminId?: number | null;
};

/** Returns null when missing. */
export const updateSubscription = async (id: number, data: UpdateSubWrite) => {
  const set: any = {};
  if (data.endAt) set.endAt = new Date(data.endAt);
  if (typeof data.status === "boolean") set.status = data.status;
  if (typeof data.remarks === "string") set.remarks = data.remarks;
  // Admin edit → stamp updated_by (created_by untouched).
  if (data.actingAdminId != null) set.updated_by = data.actingAdminId;
  const sub = await prisma.testSeriesSubscription.update({ where: { id }, data: set }).catch(() => null);
  return sub ? { subscription: subscriptionDto(sub) } : null;
};

/** Returns false when missing. */

/**
 * The customer owning this subscription, or null if it doesn't exist.
 *
 * Read BEFORE an admin revoke (status flip / date change / delete) so the caller
 * can flush that customer's per-user route cache. On delete the row is gone
 * afterwards, so the id cannot be resolved after the mutation.
 */
export const getSubscriptionCustomerId = async (id: number): Promise<number | null> =>
  (
    await prisma.testSeriesSubscription.findUnique({
      where: { id },
      select: { customerId: true },
    })
  )?.customerId ?? null;

export const deleteSubscription = async (id: number): Promise<boolean> => {
  const exists = await prisma.testSeriesSubscription.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return false;
  await prisma.testSeriesSubscription.delete({ where: { id } });
  return true;
};

// GET-by-id detail for the admin Subscription Details page — same populated shape
// contract as the other product-type detail endpoints (customer / test series /
// plan populated; razorpay ids + order type from the linked ws_test_series_order).
// Returns "not_found" when the id is unknown.
export const getSubscriptionById = async (id: number): Promise<"not_found" | any> => {
  const sub = await prisma.testSeriesSubscription.findUnique({ where: { id } });
  if (!sub) return "not_found";
  const now = new Date();
  const [customer, series, plan, order] = await Promise.all([
    sub.customerId != null
      ? prisma.customer.findUnique({ where: { id: sub.customerId }, select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } })
      : null,
    sub.testSeriesId != null
      ? prisma.testSeries.findUnique({ where: { id: sub.testSeriesId }, select: { id: true, title: true, thumbnail: true } })
      : null,
    sub.planId != null
      ? prisma.testSeriesPrice.findUnique({ where: { id: sub.planId }, select: { id: true, name: true, durationDays: true, price: true } })
      : null,
    sub.orderId != null
      ? prisma.testSeriesOrder.findUnique({ where: { id: sub.orderId }, select: { id: true, paymentMethod: true, orderType: true, razorpayOrderId: true, razorpayPaymentId: true, transactionId: true } })
      : null,
  ]);

  const customerRef = customer
    ? (() => {
        const { firstName, lastName } = splitFullName(customer.fullName);
        return { _id: String(customer.id), firstName, lastName, phoneNumber: customer.phoneNumber, emailAddress: customer.emailAddress ?? null };
      })()
    : sub.customerId != null
      ? String(sub.customerId)
      : null;

  return {
    _id: String(sub.id),
    customerId: customerRef,
    testSeriesId: series
      ? { _id: String(series.id), name: series.title ?? null, image: series.thumbnail ?? null }
      : sub.testSeriesId != null
        ? String(sub.testSeriesId)
        : null,
    planId: plan
      ? { _id: String(plan.id), name: plan.name ?? null, duration: plan.durationDays ?? null, price: num(plan.price) }
      : sub.planId != null
        ? String(sub.planId)
        : null,
    orderType: order?.orderType ?? null,
    // Gateway from the linked order (razorpay|bank|cash|…); falls back to the
    // subscription's backend/online split when no order row is linked.
    paymentMethod: order?.paymentMethod ? String(order.paymentMethod).toLowerCase() : sub.paymentType === "backend" ? "backend" : "online",
    razorpayOrderId: blankToNull(order?.razorpayOrderId),
    razorpayPaymentId: blankToNull(order?.razorpayPaymentId),
    bankTransactionId: blankToNull(order?.transactionId),
    price: num(sub.price),
    paidAmount: num(sub.price),
    startAt: sub.startAt ?? null,
    endAt: sub.endAt ?? null,
    remarks: sub.remarks ?? null,
    paymentType: sub.paymentType,
    isActive: normalizeStatus({ status: sub.status, endAt: sub.endAt }, now) === "active",
    status: sub.status,
    createdAt: sub.createdAt ?? null,
    updatedAt: sub.updatedAt ?? null,
  };
};

export type ListOrdersOpts = {
  testSeriesId: number | null;
  customerId: number | null;
  status: string | null;
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
