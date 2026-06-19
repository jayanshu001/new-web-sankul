/**
 * ExamCountdown + ExamCountdownCategory — dual-path SQL/Mongo. Net-new SQL
 * tables ws_exam_countdown(_category) (2026-06-19), backfilled from Mongo.
 * Gated behind `isMysqlModule("exam-countdown")`.
 *
 * Scope: the STANDALONE admin CRUD + client feed (categories, countdowns with
 * daysLeft, upcoming). The EMBEDDED examCountdownIds[] populated inside Book/
 * Course/Ebook/Package detail responses stays Mongo — those catalog SQL tables
 * carry no examCountdown columns (documented catalog drift).
 *
 * All ids are SQL ints at runtime; DTOs restringify to the Mongo doc shape so
 * the admin/client response contracts are unchanged.
 */
import { isMysqlModule } from "../../config/migration";
import { prisma } from "../../config/prisma";

export const EXAM_COUNTDOWN_MODULE = "exam-countdown";
export const isExamCountdownMysql = (): boolean => isMysqlModule(EXAM_COUNTDOWN_MODULE);

export const parseEcId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// ── DTOs ───────────────────────────────────────────────────────────────────────
const catDto = (r: any) => ({
  _id: String(r.id),
  name: r.name,
  colorHex: r.colorHex,
  order: r.order,
  status: r.status,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

/** Admin countdown DTO — categoryId populated to {_id,name,colorHex} like Mongo. */
const countdownAdminDto = (r: any) => ({
  _id: String(r.id),
  title: r.title,
  categoryId: r.category ? { _id: String(r.category.id), name: r.category.name, colorHex: r.category.colorHex } : null,
  examDate: r.examDate,
  description: r.description ?? "",
  status: r.status,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

// ── Embedded populate resolvers (C6) ────────────────────────────────────────
// Catalog detail responses (book/course/ebook/live-course) store the attached
// countdown/category ids as a JSON int array on the catalog row. These resolve
// that array to the SAME populated shape Mongo's .populate() returned, order
// preserved: examCountdownIds → {_id,title,examDate}; categories → {_id,name,colorHex}.

/** Coerce a stored JSON column (int[] | string[] | null) to a clean int[]. */
export const parseIdArray = (json: any): number[] => {
  const a = Array.isArray(json) ? json : [];
  const out: number[] = [];
  for (const v of a) { const n = Number(v); if (Number.isInteger(n) && n > 0) out.push(n); }
  return [...new Set(out)];
};

export const resolveCountdownDtos = async (
  ids: number[]
): Promise<{ _id: string; title: string; examDate: Date }[]> => {
  if (!ids.length) return [];
  const rows = await prisma.examCountdown.findMany({
    where: { id: { in: ids } },
    select: { id: true, title: true, examDate: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ _id: String(r.id), title: r.title, examDate: r.examDate }));
};

export const resolveCountdownCategoryDtos = async (
  ids: number[]
): Promise<{ _id: string; name: string; colorHex: string }[]> => {
  if (!ids.length) return [];
  const rows = await prisma.examCountdownCategory.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, colorHex: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids
    .map((id) => byId.get(id))
    .filter((r): r is NonNullable<typeof r> => !!r)
    .map((r) => ({ _id: String(r.id), name: r.name, colorHex: r.colorHex }));
};

/** Convenience: resolve a catalog row's two stored JSON columns in one call. */
export const populateExamCountdowns = async (row: {
  examCountdownIds?: any; examCountdownCategoryIds?: any;
}): Promise<{
  examCountdownIds: { _id: string; title: string; examDate: Date }[];
  examCountdownCategoryIds: { _id: string; name: string; colorHex: string }[];
}> => {
  const [examCountdownIds, examCountdownCategoryIds] = await Promise.all([
    resolveCountdownDtos(parseIdArray(row?.examCountdownIds)),
    resolveCountdownCategoryDtos(parseIdArray(row?.examCountdownCategoryIds)),
  ]);
  return { examCountdownIds, examCountdownCategoryIds };
};

// ── Category CRUD ──────────────────────────────────────────────────────────────
export const listCategoriesAdmin = async () => {
  const rows = await prisma.examCountdownCategory.findMany({ orderBy: [{ order: "asc" }, { name: "asc" }] });
  return rows.map(catDto);
};

/** Returns {conflict:true} if the name already exists (→ 409). */
export const createCategory = async (input: { name: string; colorHex: string; order: number; status: boolean }) => {
  const dup = await prisma.examCountdownCategory.findFirst({ where: { name: input.name } });
  if (dup) return { conflict: true as const };
  const row = await prisma.examCountdownCategory.create({ data: input });
  return { conflict: false as const, data: catDto(row) };
};

export const updateCategory = async (id: number, update: Partial<{ name: string; colorHex: string; order: number; status: boolean }>) => {
  const exists = await prisma.examCountdownCategory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { notFound: true as const };
  if (update.name !== undefined) {
    const dup = await prisma.examCountdownCategory.findFirst({ where: { name: update.name, id: { not: id } } });
    if (dup) return { conflict: true as const };
  }
  const row = await prisma.examCountdownCategory.update({ where: { id }, data: update });
  return { data: catDto(row) };
};

/** Delete blocked if any countdown references the category (mirror Mongo guard). */
export const deleteCategory = async (id: number) => {
  const exists = await prisma.examCountdownCategory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { notFound: true as const };
  const inUse = await prisma.examCountdown.findFirst({ where: { categoryId: id }, select: { id: true } });
  if (inUse) return { inUse: true as const };
  await prisma.examCountdownCategory.delete({ where: { id } });
  return { ok: true as const };
};

// ── Countdown CRUD ─────────────────────────────────────────────────────────────
export const listCountdownsAdmin = async (opts: {
  categoryId: number | null; search: string | null; includePast: boolean; skip: number; limitNum: number; pageNum: number; todayUTC: Date;
}) => {
  const where: any = {};
  if (opts.categoryId) where.categoryId = opts.categoryId;
  if (opts.search) where.title = { contains: opts.search };
  if (!opts.includePast) where.examDate = { gte: opts.todayUTC };

  const [rows, total] = await Promise.all([
    prisma.examCountdown.findMany({ where, orderBy: { examDate: "asc" }, skip: opts.skip, take: opts.limitNum }),
    prisma.examCountdown.count({ where }),
  ]);
  const withCat = await attachCategories(rows);
  return { data: withCat.map(countdownAdminDto), pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
};

/** Manual category join (no Prisma relation declared on these flat models). */
const attachCategories = async (rows: any[]) => {
  const catIds = [...new Set(rows.map((r) => r.categoryId).filter((x) => x != null))] as number[];
  if (!catIds.length) return rows.map((r) => ({ ...r, category: null }));
  const cats = await prisma.examCountdownCategory.findMany({ where: { id: { in: catIds } } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  return rows.map((r) => ({ ...r, category: r.categoryId ? byId.get(r.categoryId) ?? null : null }));
};

/** Returns {notFound} if category missing, {disabled} if category status=false. */
export const createCountdown = async (input: { title: string; categoryId: number; examDate: Date; description: string; status: boolean }) => {
  const cat = await prisma.examCountdownCategory.findUnique({ where: { id: input.categoryId }, select: { id: true, status: true } });
  if (!cat) return { catNotFound: true as const };
  if (!cat.status) return { catDisabled: true as const };
  const row = await prisma.examCountdown.create({ data: input });
  const [withCat] = await attachCategories([row]);
  return { data: countdownAdminDto(withCat) };
};

export const updateCountdown = async (id: number, update: Partial<{ title: string; categoryId: number; examDate: Date; description: string; status: boolean }>) => {
  const exists = await prisma.examCountdown.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { notFound: true as const };
  if (update.categoryId !== undefined) {
    const cat = await prisma.examCountdownCategory.findUnique({ where: { id: update.categoryId }, select: { id: true, status: true } });
    if (!cat) return { catNotFound: true as const };
    if (!cat.status) return { catDisabled: true as const };
  }
  const row = await prisma.examCountdown.update({ where: { id }, data: update });
  const [withCat] = await attachCategories([row]);
  return { data: countdownAdminDto(withCat) };
};

export const deleteCountdown = async (id: number) => {
  const exists = await prisma.examCountdown.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { notFound: true as const };
  await prisma.examCountdown.delete({ where: { id } });
  return { ok: true as const };
};

// ── Client feed ──────────────────────────────────────────────────────────────────
const MS_PER_DAY = 86_400_000;
const daysLeftOf = (examDate: Date, todayUTC: Date) => {
  const exam = new Date(Date.UTC(examDate.getUTCFullYear(), examDate.getUTCMonth(), examDate.getUTCDate()));
  return Math.ceil((exam.getTime() - todayUTC.getTime()) / MS_PER_DAY);
};
const clientRow = (r: any, todayUTC: Date) => ({
  _id: String(r.id),
  title: r.title,
  examDate: r.examDate,
  daysLeft: daysLeftOf(r.examDate, todayUTC),
  category: r.category ? { _id: String(r.category.id), name: r.category.name, colorHex: r.category.colorHex } : null,
});

export const listCategoriesClient = async (opts: { search: string | null; skip: number; limit: number; page: number }) => {
  const where: any = { status: true };
  if (opts.search) where.name = { contains: opts.search };
  const [rows, total] = await Promise.all([
    prisma.examCountdownCategory.findMany({ where, orderBy: [{ order: "asc" }, { name: "asc" }], skip: opts.skip, take: opts.limit }),
    prisma.examCountdownCategory.count({ where }),
  ]);
  const data = rows.map((r) => ({ _id: String(r.id), name: r.name, colorHex: r.colorHex, order: r.order }));
  return { data, total };
};

export const listCountdownsClient = async (opts: {
  categoryId: number | null; search: string | null; includePast: boolean; skip: number; limitNum: number; pageNum: number; todayUTC: Date;
}) => {
  const where: any = { status: true };
  if (opts.categoryId) where.categoryId = opts.categoryId;
  if (opts.search) where.title = { contains: opts.search };
  if (!opts.includePast) where.examDate = { gte: opts.todayUTC };
  const [rows, total] = await Promise.all([
    prisma.examCountdown.findMany({ where, orderBy: { examDate: "asc" }, skip: opts.skip, take: opts.limitNum }),
    prisma.examCountdown.count({ where }),
  ]);
  const withCat = await attachCategories(rows);
  return { data: withCat.map((r) => clientRow(r, opts.todayUTC)), total };
};

export const upcomingCountdownsClient = async (limitNum: number, todayUTC: Date) => {
  const rows = await prisma.examCountdown.findMany({
    where: { status: true, examDate: { gte: todayUTC } },
    orderBy: { examDate: "asc" }, take: limitNum,
  });
  const withCat = await attachCategories(rows);
  return withCat.map((r) => clientRow(r, todayUTC));
};
