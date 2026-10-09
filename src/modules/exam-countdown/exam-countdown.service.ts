/**
 * ExamCountdown + ExamCountdownCategory: admin CRUD, client feed, and the
 * resolvers that populate countdown ids embedded on catalog rows.
 */
import { prisma } from "../../config/prisma";
import { nextOrder } from "../../utils/listOrdering";
import { buildPrismaSearch, buildPrismaPrefixSearch } from "../../utils/searchFilter";
import { parsePositiveInt } from "../../utils/parseId";
import type { Prisma } from "@prisma/client";

export const parseEcId = parsePositiveInt;

const catDto = (r: any) => ({
  _id: String(r.id),
  name: r.name,
  colorHex: r.colorHex,
  order: r.order,
  status: r.status,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

/** Admin countdown DTO; categoryId populated to {_id,name,colorHex}. */
const countdownAdminDto = (r: any) => ({
  _id: String(r.id),
  title: r.title,
  categoryId: r.category ? { _id: String(r.category.id), name: r.category.name, colorHex: r.category.colorHex } : null,
  goalId: r.goalId != null ? String(r.goalId) : null,
  goalLabelId: r.goalLabelId != null ? r.goalLabelId : null,
  examDate: r.examDate,
  status: r.status,
  createdAt: r.createdAt ?? null,
  updatedAt: r.updatedAt ?? null,
});

/**
 * goalLabelId requires goalId; goalId must exist; the label must exist in that
 * goal's labels JSON. Returns an error string, or null when valid/omitted.
 */
export const validateGoalPair = async (
  goalId: number | null | undefined,
  goalLabelId: number | null | undefined
): Promise<string | null> => {
  if (goalLabelId != null && goalId == null) return "goalId is required when goalLabelId is provided.";
  if (goalId == null) return null;
  const goal = await prisma.customerTargetGoal.findUnique({ where: { id: goalId }, select: { labels: true } });
  if (!goal) return "Goal not found for the supplied goalId.";
  if (goalLabelId != null) {
    const labels = Array.isArray(goal.labels) ? (goal.labels as any[]) : [];
    const owns = labels.some((l) => Number(l?.id) === goalLabelId);
    if (!owns) return "goalLabelId does not belong to the supplied goalId.";
  }
  return null;
};

// Catalog rows (book/course/ebook/live-course) store countdown/category ids as a
// JSON int array; these resolve them to populated objects, order preserved.

/** Accepts int[] | string[] | null. */
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

// Pagination is opt-in: omit skip/take for the full list.
export const listCategoriesAdmin = async (opts?: { search?: string | null; status?: boolean; skip?: number; take?: number }) => {
  const where: Prisma.ExamCountdownCategoryWhereInput = {};
  const search = buildPrismaPrefixSearch(opts?.search, ["name"]);
  if (search) where.AND = search.AND;
  if (opts?.status !== undefined) where.status = opts.status;
  const [rows, total] = await Promise.all([
    // Recency is the contract on admin lists — see utils/listOrdering. The client
    // reader below still sorts by `order`.
    prisma.examCountdownCategory.findMany({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: opts?.skip, take: opts?.take }),
    prisma.examCountdownCategory.count({ where }),
  ]);
  return { data: rows.map(catDto), total };
};

/** Lets pickers resolve a saved id to its label without paging the list. */
export const getCategoryAdmin = async (id: number) => {
  const row = await prisma.examCountdownCategory.findUnique({ where: { id } });
  return row ? catDto(row) : null;
};

/** Returns {conflict:true} if the name already exists (→ 409). */
export const createCategory = async (input: { name: string; colorHex: string; order?: number; status: boolean }) => {
  const dup = await prisma.examCountdownCategory.findFirst({ where: { name: input.name } });
  if (dup) return { conflict: true as const };
  // No explicit order → previous row + 1 (see utils/listOrdering).
  const order = input.order ?? nextOrder((await prisma.examCountdownCategory.findFirst({ orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { order: true } }))?.order);
  const row = await prisma.examCountdownCategory.create({ data: { ...input, order } });
  return { conflict: false as const, data: catDto(row) };
};

// Returns {notFound}, {conflict} on a duplicate name, or {data}.
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

/** Blocked while any countdown references the category. */
export const deleteCategory = async (id: number) => {
  const exists = await prisma.examCountdownCategory.findUnique({ where: { id }, select: { id: true } });
  if (!exists) return { notFound: true as const };
  const inUse = await prisma.examCountdown.findFirst({ where: { categoryId: id }, select: { id: true } });
  if (inUse) return { inUse: true as const };
  await prisma.examCountdownCategory.delete({ where: { id } });
  return { ok: true as const };
};

export const listCountdownsAdmin = async (opts: {
  categoryIds: number[] | null; search: string | null; includePast: boolean; skip: number; limitNum: number; pageNum: number; todayUTC: Date;
}) => {
  const where: Prisma.ExamCountdownWhereInput = {};
  if (opts.categoryIds && opts.categoryIds.length) {
    where.categoryId = opts.categoryIds.length === 1 ? opts.categoryIds[0] : { in: opts.categoryIds };
  }
  const titleSearch = buildPrismaPrefixSearch(opts.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;
  if (!opts.includePast) where.examDate = { gte: opts.todayUTC };

  const [rows, total] = await Promise.all([
    prisma.examCountdown.findMany({ where, orderBy: { examDate: "asc" }, skip: opts.skip, take: opts.limitNum }),
    prisma.examCountdown.count({ where }),
  ]);
  const withCat = await attachCategories(rows);
  return { data: withCat.map(countdownAdminDto), pagination: { total, page: opts.pageNum, limit: opts.limitNum, totalPages: Math.ceil(total / opts.limitNum) } };
};

/** Manual join: no Prisma relation on these models. */
const attachCategories = async (rows: any[]) => {
  const catIds = [...new Set(rows.map((r) => r.categoryId).filter((x) => x != null))] as number[];
  if (!catIds.length) return rows.map((r) => ({ ...r, category: null }));
  const cats = await prisma.examCountdownCategory.findMany({ where: { id: { in: catIds } } });
  const byId = new Map(cats.map((c) => [c.id, c]));
  return rows.map((r) => ({ ...r, category: r.categoryId ? byId.get(r.categoryId) ?? null : null }));
};

/** Returns {notFound} if category missing, {disabled} if category status=false. */
export const createCountdown = async (input: { title: string; categoryId: number; examDate: Date; status: boolean; goalId?: number | null; goalLabelId?: number | null }) => {
  const cat = await prisma.examCountdownCategory.findUnique({ where: { id: input.categoryId }, select: { id: true, status: true } });
  if (!cat) return { catNotFound: true as const };
  if (!cat.status) return { catDisabled: true as const };
  const goalError = await validateGoalPair(input.goalId, input.goalLabelId);
  if (goalError) return { goalError };
  const row = await prisma.examCountdown.create({
    data: {
      title: input.title, categoryId: input.categoryId, examDate: input.examDate,
      status: input.status,
      goalId: input.goalId ?? null, goalLabelId: input.goalLabelId ?? null,
    },
  });
  const [withCat] = await attachCategories([row]);
  return { data: countdownAdminDto(withCat) };
};

// Same failure shapes as createCountdown; the goal pair is checked on merged values.
export const updateCountdown = async (id: number, update: Partial<{ title: string; categoryId: number; examDate: Date; status: boolean; goalId: number | null; goalLabelId: number | null }>) => {
  const existing = await prisma.examCountdown.findUnique({ where: { id }, select: { id: true, goalId: true, goalLabelId: true } });
  if (!existing) return { notFound: true as const };
  if (update.categoryId !== undefined) {
    const cat = await prisma.examCountdownCategory.findUnique({ where: { id: update.categoryId }, select: { id: true, status: true } });
    if (!cat) return { catNotFound: true as const };
    if (!cat.status) return { catDisabled: true as const };
  }
  // Validate the goal pair against the resulting (merged) values so a partial
  // update that touches only one of the two is still checked as a whole.
  if (update.goalId !== undefined || update.goalLabelId !== undefined) {
    const nextGoalId = update.goalId !== undefined ? update.goalId : existing.goalId;
    const nextGoalLabelId = update.goalLabelId !== undefined ? update.goalLabelId : existing.goalLabelId;
    const goalError = await validateGoalPair(nextGoalId, nextGoalLabelId);
    if (goalError) return { goalError };
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
  const where: Prisma.ExamCountdownCategoryWhereInput = { status: true };
  const search = buildPrismaSearch(opts.search, ["name"]);
  if (search) where.AND = search.AND;
  const [rows, total] = await Promise.all([
    prisma.examCountdownCategory.findMany({ where, orderBy: [{ order: "asc" }, { createdAt: "asc" }, { id: "asc" }], skip: opts.skip, take: opts.limit }),
    prisma.examCountdownCategory.count({ where }),
  ]);
  const data = rows.map((r) => ({ _id: String(r.id), name: r.name, colorHex: r.colorHex, order: r.order }));
  return { data, total };
};

export const listCountdownsClient = async (opts: {
  categoryId: number | null; search: string | null; includePast: boolean; skip: number; limitNum: number; pageNum: number; todayUTC: Date;
}) => {
  const where: Prisma.ExamCountdownWhereInput = { status: true };
  if (opts.categoryId) where.categoryId = opts.categoryId;
  const titleSearch = buildPrismaSearch(opts.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;
  if (!opts.includePast) where.examDate = { gte: opts.todayUTC };
  const [rows, total] = await Promise.all([
    // No display-order column: examDate is the ordering, created_at keeps paging deterministic.
    prisma.examCountdown.findMany({ where, orderBy: [{ examDate: "asc" }, { createdAt: "asc" }], skip: opts.skip, take: opts.limitNum }),
    prisma.examCountdown.count({ where }),
  ]);
  const withCat = await attachCategories(rows);
  return { data: withCat.map((r) => clientRow(r, opts.todayUTC)), total };
};

// Active countdowns from today on, nearest exam first.
export const upcomingCountdownsClient = async (opts: {
  search: string | null; skip: number; limit: number; page: number; todayUTC: Date;
}) => {
  const where: Prisma.ExamCountdownWhereInput = { status: true, examDate: { gte: opts.todayUTC } };
  const titleSearch = buildPrismaSearch(opts.search, ["title"]);
  if (titleSearch) where.AND = titleSearch.AND;
  const [rows, total] = await Promise.all([
    prisma.examCountdown.findMany({ where, orderBy: { examDate: "asc" }, skip: opts.skip, take: opts.limit }),
    prisma.examCountdown.count({ where }),
  ]);
  const withCat = await attachCategories(rows);
  return { data: withCat.map((r) => clientRow(r, opts.todayUTC)), total };
};
