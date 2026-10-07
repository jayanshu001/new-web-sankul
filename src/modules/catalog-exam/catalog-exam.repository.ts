// Exam categories: Prisma queries.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { examInCategoryWhere, subjectStartedWhere } from "./exam-category-pivot.where";
import { buildPrismaSearch, searchTokens } from "../../utils/searchFilter";

export const catalogExamRepository = {
  /** Soft-deleted rows read as absent (404). */
  findCategoryById: (id: number) =>
    prisma.examCategory.findFirst({ where: { id, deleted: false } }),

  /** -1 when there are no categories. */
  maxCategoryOrder: async (): Promise<number> => {
    const top = await prisma.examCategory.findFirst({ orderBy: { order_by: "desc" }, select: { order_by: true } });
    return top?.order_by ?? -1;
  },
  createCategory: (data: Prisma.ExamCategoryUncheckedCreateInput) =>
    prisma.examCategory.create({ data }),
  updateCategory: (id: number, data: Prisma.ExamCategoryUncheckedUpdateInput) =>
    prisma.examCategory.update({ where: { id }, data }),
  /** Reads already exclude soft-deleted rows; avoids dangling pivots. */
  softDeleteCategory: (id: number) =>
    prisma.examCategory.update({ where: { id }, data: { deleted: true, updated_at: new Date() } }),
  childCount: (id: number) =>
    prisma.examCategory.count({ where: { parent: id, deleted: false } }),
  /** Any status, including pivot links. */
  examCountForCategory: (id: number) =>
    prisma.exam.count({ where: examInCategoryWhere(id) }),

  /** Always excludes soft-deleted rows. `parentRoot` selects parent_id = 0. */
  listCategories: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
    skip?: number;
    take?: number;
    /** Admin listing; the default keeps the curated order_by sort. */
    newestFirst?: boolean;
  }) => {
    const where = catalogExamRepository.categoryWhere(opts);
    return prisma.examCategory.findMany({
      where,
      orderBy: opts.newestFirst
        ? [{ created_at: "desc" }, { id: "desc" }]
        : [{ order_by: "asc" }, { created_at: "asc" }],
      ...(opts.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts.take !== undefined ? { take: opts.take } : {}),
    });
  },

  countCategories: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
  }) => prisma.examCategory.count({ where: catalogExamRepository.categoryWhere(opts) }),

  categoryWhere: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
  }) => {
    const where: any = { deleted: false };
    if (opts.parentRoot) where.parent = 0;
    else if (opts.parentId !== undefined) where.parent = opts.parentId;
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) where.AND = search.AND;
    if (opts.status !== undefined) where.status = opts.status;
    return where;
  },

  listAllActive: () =>
    prisma.examCategory.findMany({
      where: { status: true, deleted: false },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    }),

  listCategoryPackages: (
    categoryId: number,
    opts: { search?: string; status?: boolean; skip: number; take: number }
  ) =>
    prisma.package.findMany({
      where: catalogExamRepository.categoryPackageWhere(categoryId, opts),
      select: { id: true, name: true, shareable_link: true, active: true, order_by: true },
      orderBy: [{ order_by: "asc" }, { created_at: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),

  countCategoryPackages: (
    categoryId: number,
    opts: { search?: string; status?: boolean }
  ) =>
    prisma.package.count({ where: catalogExamRepository.categoryPackageWhere(categoryId, opts) }),

  categoryPackageWhere: (
    categoryId: number,
    opts: { search?: string; status?: boolean }
  ) => {
    const where: any = { examCategoryPackage: { some: { examCategoryId: categoryId } } };
    const search = buildPrismaSearch(opts.search, ["name"]);
    if (search) where.AND = search.AND;
    if (opts.status !== undefined) where.active = opts.status;
    return where;
  },

  listPackagePrices: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { packageId: { in: packageIds }, status: true },
          select: { packageId: true, price: true, isDefault: true },
        })
      : Promise.resolve([]),

  /**
   * Courses and live courses linked to a category as one paginated set, each
   * tagged with `type`. Raw SQL because the links differ: courses use the
   * ws_exam_category_course pivot, live courses the JSON column
   * ws_live_course.exam_categories ([{ category, order }], where `category` may be
   * a JSON string or number, hence the CAST). The union is paged in SQL; paging it
   * in application code would give each source its own offset.
   */
  listCategoryCourses: (
    categoryId: number,
    opts: { search?: string; status?: boolean; type?: CategoryCourseType; skip: number; take: number }
  ) => {
    const { sql, params } = buildCategoryCoursesUnion(categoryId, opts);
    return prisma.$queryRawUnsafe<CategoryCourseRow[]>(
      // [order_by asc, created_at desc], with `id` as the final tiebreak so a row
      // can never straddle two pages.
      `SELECT u.type, u.id, u.name, u.status, u.order_by FROM (${sql}) u
        ORDER BY u.order_by ASC, u.created_at DESC, u.id ASC
        LIMIT ? OFFSET ?`,
      ...params,
      opts.take,
      opts.skip
    );
  },

  countCategoryCourses: async (
    categoryId: number,
    opts: { search?: string; status?: boolean; type?: CategoryCourseType }
  ) => {
    const { sql, params } = buildCategoryCoursesUnion(categoryId, opts);
    const rows = await prisma.$queryRawUnsafe<{ total: bigint | number }[]>(
      `SELECT COUNT(*) AS total FROM (${sql}) u`,
      ...params
    );
    return Number(rows[0]?.total ?? 0);
  },

  listActiveChildren: (parentId: number, opts?: { search?: string; skip?: number; take?: number }) =>
    prisma.examCategory.findMany({
      where: catalogExamRepository.activeChildrenWhere(parentId, opts),
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),

  countActiveChildren: (parentId: number, opts?: { search?: string }) =>
    prisma.examCategory.count({ where: catalogExamRepository.activeChildrenWhere(parentId, opts) }),

  activeChildrenWhere: (parentId: number, opts?: { search?: string }) => ({
    parent: parentId,
    status: true,
    deleted: false,
    ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
  }),

  /**
   * Counts only active, started, subject-type quizzes (drafts, daily tests and
   * scheduled-later quizzes must not inflate the catalog `count`). Includes pivot links.
   */
  countExams: (categoryId: number) =>
    prisma.exam.count({ where: { AND: [examInCategoryWhere(categoryId), { status: true, type: "subject" }, subjectStartedWhere(new Date())] } }),

  /**
   * Active child-folder count per parent; drives both `havingChildDirectory` and
   * the directory-node `count`.
   */
  childCountsByParent: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.examCategory.groupBy({ by: ["parent"], where: { parent: { in: categoryIds }, status: true, deleted: false }, _count: { _all: true } })
      : Promise.resolve([] as { parent: number; _count: { _all: number } }[]),

  /** Ids with at least one child regardless of status (a container is non-leaf even if its children are disabled). */
  childParentIds: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.examCategory.findMany({
          where: { parent: { in: categoryIds }, deleted: false },
          distinct: ["parent"],
          select: { parent: true },
        })
      : Promise.resolve([]),

  // Batched loader for ancestor resolution; deleted rows are excluded so a stale parent id resolves to nothing.
  categoriesByIds: (ids: number[]) =>
    ids.length
      ? prisma.examCategory.findMany({
          where: { id: { in: ids }, deleted: false },
          select: { id: true, name: true, parent: true },
        })
      : Promise.resolve([]),
};

/** Hyphenated to match admin-material's linked products; the admin FE keys rows by `type-id`. */
export type CategoryCourseType = "course" | "live-course";

export type CategoryCourseRow = {
  type: CategoryCourseType;
  id: number;
  name: string | null;
  /** MySQL returns TINYINT(1) for these BOOLEAN columns, so 0/1 rather than a JS boolean. */
  status: number | boolean | null;
  order_by: number | null;
};

/**
 * Search and status are applied per branch so each can use its own name index.
 * `type` narrows the union to one branch; absent means both.
 *
 * The live-course branch is `SELECT DISTINCT` over a JSON_TABLE join so a course
 * listing the same category twice yields one row. EXISTS is not an option: MySQL
 * 8.0 will not correlate the outer `lc.exam_categories` into a JSON_TABLE inside a
 * subquery and silently returns zero rows.
 */
function buildCategoryCoursesUnion(
  categoryId: number,
  opts: { search?: string; status?: boolean; type?: CategoryCourseType }
): { sql: string; params: unknown[] } {
  const toks = searchTokens(opts.search);
  const tokParams = toks.map((t) => `%${t}%`);
  const nameFilter = toks.map(() => "AND {alias}.name LIKE ?").join(" ");
  // Bind as 1/0: MySQL will not coerce a JS boolean bound through the driver.
  const statusParam = opts.status === undefined ? [] : [opts.status ? 1 : 0];
  const filters = (alias: string) =>
    `${nameFilter.replace(/\{alias\}/g, alias)}${opts.status === undefined ? "" : ` AND ${alias}.status = ?`}`;

  const branches: string[] = [];
  const params: unknown[] = [];

  if (opts.type === undefined || opts.type === "course") {
    branches.push(`
    SELECT 'course' AS type, c.id AS id, c.name AS name, c.status AS status,
           c.order_by AS order_by, c.created_at AS created_at
      FROM ws_exam_category_course ecc
      JOIN ws_course c ON c.id = ecc.course_id
     WHERE ecc.exam_category_id = ? ${filters("c")}`);
    params.push(categoryId, ...tokParams, ...statusParam);
  }

  if (opts.type === undefined || opts.type === "live-course") {
    branches.push(`
    SELECT DISTINCT 'live-course' AS type, lc.id AS id, lc.name AS name, lc.status AS status,
           lc.ordered AS order_by, lc.created_at AS created_at
      FROM ws_live_course lc
      JOIN JSON_TABLE(
             COALESCE(lc.exam_categories, JSON_ARRAY()),
             '$[*]' COLUMNS (category JSON PATH '$.category')
           ) jt ON CAST(JSON_UNQUOTE(jt.category) AS UNSIGNED) = ?
     WHERE 1 = 1 ${filters("lc")}`);
    params.push(categoryId, ...tokParams, ...statusParam);
  }

  return { sql: branches.join("\n    UNION ALL\n"), params };
}
