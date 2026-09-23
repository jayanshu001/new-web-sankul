import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { examInCategoryWhere, subjectStartedWhere } from "./exam-category-pivot.where";
import { buildPrismaSearch, searchTokens } from "../../utils/searchFilter";

/**
 * Prisma persistence for the catalog · exam READ branch (flag OFF). Scoped to
 * category navigation: a parent category, its active (status + not-deleted)
 * children via the `parent_id` self-FK, per-child UNCONDITIONAL exam counts, and
 * a has-grandchildren check.
 */
export const catalogExamRepository = {
  /** Single non-deleted exam category by id (soft-deleted rows read as absent → 404). */
  findCategoryById: (id: number) =>
    prisma.examCategory.findFirst({ where: { id, deleted: false } }),

  // ── category writes ─────────────────────────────────────────────────────────
  createCategory: (data: Prisma.ExamCategoryUncheckedCreateInput) =>
    prisma.examCategory.create({ data }),
  updateCategory: (id: number, data: Prisma.ExamCategoryUncheckedUpdateInput) =>
    prisma.examCategory.update({ where: { id }, data }),
  /** Soft-delete (deleted=true) — reads already exclude these; avoids dangling pivots. */
  softDeleteCategory: (id: number) =>
    prisma.examCategory.update({ where: { id }, data: { deleted: true, updated_at: new Date() } }),
  /** Active (not soft-deleted) direct children of a category. */
  childCount: (id: number) =>
    prisma.examCategory.count({ where: { parent: id, deleted: false } }),
  /** Exams referencing this category (any status), incl. ws_exam_category_pivot. */
  examCountForCategory: (id: number) =>
    prisma.exam.count({ where: examInCategoryWhere(id) }),

  /**
   * List exam categories with optional parent / name-search / status filters.
   * Always excludes soft-deleted rows (Mongo parity — deleted docs don't exist
   * in Mongo). Ordered by `order_by ASC, created_at ASC` (client catalog ordering).
   * `parentRoot` selects top-level rows (parent_id = 0, the SQL root sentinel).
   * When `skip`/`take` are provided the result is paginated.
   */
  listCategories: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
    skip?: number;
    take?: number;
    /** Admin listing: newest-created first. Default keeps the curated order_by sort. */
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

  /** Count matching the same filter as `listCategories` (for pagination). */
  countCategories: (opts: {
    parentRoot?: boolean;
    parentId?: number;
    search?: string;
    status?: boolean;
  }) => prisma.examCategory.count({ where: catalogExamRepository.categoryWhere(opts) }),

  /** Shared WHERE builder for the category list/count. */
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

  /** All active (status + not-deleted) categories, for tree assembly. */
  listAllActive: () =>
    prisma.examCategory.findMany({
      where: { status: true, deleted: false },
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
    }),

  /** Packages linked to a category via ws_exam_category_package (paginated). */
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

  /** Default/active price rows for the given package ids (representative price). */
  listPackagePrices: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseEbookPrice.findMany({
          where: { packageId: { in: packageIds }, status: true },
          select: { packageId: true, price: true, isDefault: true },
        })
      : Promise.resolve([]),

  /**
   * Everything a category is attached to on the admin Courses tab: recorded
   * Courses AND Live Courses, as ONE paginated set, each row tagged with `type`.
   *
   * Raw SQL because the two links have nothing in common structurally:
   *   course       → pivot ws_exam_category_course
   *   live course  → JSON column ws_live_course.exam_categories, holding
   *                  [{ category, order }] where `category` may be a JSON string
   *                  ("12") or a number (12) depending on which admin build wrote
   *                  it — hence the CAST-to-UNSIGNED comparison.
   * Mirrors admin-material's `buildLinkedProductsQuery`, minus the package branch:
   * the exam-category page has its own Package tab (GET .../packages), so listing
   * packages here too would double-count them in the UI.
   *
   * Paging a UNION in application code would be wrong (each source would get its
   * own offset), so the union is paged in SQL.
   */
  listCategoryCourses: (
    categoryId: number,
    opts: { search?: string; status?: boolean; type?: CategoryCourseType; skip: number; take: number }
  ) => {
    const { sql, params } = buildCategoryCoursesUnion(categoryId, opts);
    return prisma.$queryRawUnsafe<CategoryCourseRow[]>(
      // Same ordering contract the courses-only query shipped with
      // ([order_by asc, created_at desc]), now spanning both kinds. `id` is the
      // final tiebreak so a row can never straddle two pages.
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

  /**
   * Active (status + not-deleted) child categories of `parentId`, ordered by
   * `order_by`. Optional name search. Mirrors the Mongo
   * `ExamCategory.find({_id:{$in:childCategoryIds}, status:true})`.
   */
  listActiveChildren: (parentId: number, opts?: { search?: string; skip?: number; take?: number }) =>
    prisma.examCategory.findMany({
      where: catalogExamRepository.activeChildrenWhere(parentId, opts),
      orderBy: [{ order_by: "asc" }, { created_at: "asc" }],
      ...(opts?.skip !== undefined ? { skip: opts.skip } : {}),
      ...(opts?.take !== undefined ? { take: opts.take } : {}),
    }),

  /** Count of active children matching the same filter as `listActiveChildren`. */
  countActiveChildren: (parentId: number, opts?: { search?: string }) =>
    prisma.examCategory.count({ where: catalogExamRepository.activeChildrenWhere(parentId, opts) }),

  /** Shared WHERE for active children list/count. */
  activeChildrenWhere: (parentId: number, opts?: { search?: string }) => ({
    parent: parentId,
    status: true,
    deleted: false,
    ...(buildPrismaSearch(opts?.search, ["name"]) ?? {}),
  }),

  /**
   * Client-facing test count for a category, incl. ws_exam_category_pivot. Counts
   * ONLY active, subject-type quizzes that have already STARTED — drafts
   * (status=false), `daily`-type, and scheduled-for-later subject quizzes are
   * excluded (they must not inflate the catalog `count`).
   */
  countExams: (categoryId: number) =>
    prisma.exam.count({ where: { AND: [examInCategoryWhere(categoryId), { status: true, type: "subject" }, subjectStartedWhere(new Date())] } }),

  /**
   * Active child-folder COUNT per parent for the given category ids. Drives both
   * `havingChildDirectory` (count > 0) AND the directory-node `count` (child-folder
   * count) so a folder-with-subfolders reports its subfolder count, not its test count.
   */
  childCountsByParent: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.examCategory.groupBy({ by: ["parent"], where: { parent: { in: categoryIds }, status: true, deleted: false }, _count: { _all: true } })
      : Promise.resolve([] as { parent: number; _count: { _all: number } }[]),

  /**
   * Of the given category ids, which have ≥1 child (regardless of status) — one
   * distinct query. Used to flag non-leaf categories in the list (a container is
   * non-leaf even if its sub-categories are disabled).
   */
  childParentIds: (categoryIds: number[]) =>
    categoryIds.length
      ? prisma.examCategory.findMany({
          where: { parent: { in: categoryIds }, deleted: false },
          distinct: ["parent"],
          select: { parent: true },
        })
      : Promise.resolve([]),

  // Batched {id, name, parent} loader for ancestor-chain resolution (one query per
  // tree level). deleted rows excluded so a stale parent id resolves to nothing.
  categoriesByIds: (ids: number[]) =>
    ids.length
      ? prisma.examCategory.findMany({
          where: { id: { in: ids }, deleted: false },
          select: { id: true, name: true, parent: true },
        })
      : Promise.resolve([]),
};

/**
 * The two kinds the admin Courses tab can surface. Hyphenated, matching the
 * spelling `admin-material`'s linked-products helper already emits — the admin FE
 * keys rows by `type-id` and routes `course` → /admin/courses/:id and
 * `live-course` → /admin/live-courses/:id.
 */
export type CategoryCourseType = "course" | "live-course";

export type CategoryCourseRow = {
  type: CategoryCourseType;
  id: number;
  name: string | null;
  /** MySQL returns TINYINT(1) for these BOOLEAN columns, so 0/1 rather than a JS boolean. */
  status: number | boolean | null;
  /** ws_course.order_by / ws_live_course.ordered — each row's own display order. */
  order_by: number | null;
};

/**
 * The two-way UNION plus its filters, as one parameterised statement.
 *
 * Search and status are applied PER BRANCH (not once over the union) so each
 * branch can use its own name index instead of filtering a materialised temp
 * table. `type` narrows the union to a single branch; absent means both.
 *
 * The live-course branch is `SELECT DISTINCT` over a JSON_TABLE join, not an
 * EXISTS subquery: a live course whose `exam_categories` array lists the same
 * category twice would otherwise emit two rows and corrupt both the page window
 * and `total`. ⚠ EXISTS is NOT an option here — MySQL 8.0 will not correlate the
 * outer `lc.exam_categories` into a JSON_TABLE inside a subquery, and returns
 * zero rows SILENTLY (no error) rather than failing. Verified on 8.0.46.
 */
function buildCategoryCoursesUnion(
  categoryId: number,
  opts: { search?: string; status?: boolean; type?: CategoryCourseType }
): { sql: string; params: unknown[] } {
  const toks = searchTokens(opts.search);
  const tokParams = toks.map((t) => `%${t}%`);
  const nameFilter = toks.map(() => "AND {alias}.name LIKE ?").join(" ");
  // Bind as 1/0 — these are TINYINT(1) columns, and MySQL will not coerce a JS
  // boolean bound through the driver.
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
