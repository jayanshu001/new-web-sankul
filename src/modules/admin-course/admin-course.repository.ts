// Admin courses: Prisma queries for courses, plans, linked content and video categories.
import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";
import { buildPrismaSearch, searchTokens } from "../../utils/searchFilter";

// Tokenized name search over a related category/book (nested relation filter, which
// the flat helper can't express). ANDs tokens; empty → {}.
function examCatNameSearch(term?: string): Prisma.ExamCategoryCourseWhereInput {
  const toks = searchTokens(term);
  return toks.length ? { AND: toks.map((t) => ({ ExamCategory: { name: { contains: t } } })) } : {};
}
function materialCatNameSearch(term?: string): Prisma.MaterialCategoryCourseWhereInput {
  const toks = searchTokens(term);
  return toks.length ? { AND: toks.map((t) => ({ MaterialCategory: { name: { contains: t } } })) } : {};
}
function courseBookNameSearch(term?: string): Prisma.CourseBookWhereInput {
  const toks = searchTokens(term);
  return toks.length ? { AND: toks.map((t) => ({ Book: { name: { contains: t } } })) } : {};
}

/**
 * Plans live in the shared ws_package_course_ebook_price table. ws_video_category has
 * no course_id, so course-scoped folders and the Root-folder automation are not
 * representable. course_category_id / educator_id are NOT NULL → 0 sentinel.
 * with_material/without_material/level are varchar, not bool.
 */
const sortByCategoryId = <T extends { categoryId: number }>(items: T[]): T[] =>
  [...items].sort((a, b) => a.categoryId - b.categoryId);

const include = {
  educator: { select: { id: true, name: true } },
  subject: { select: { id: true, title: true } },
  VideoCategory: { select: { id: true, title: true } },
};

export const adminCourseRepository = {
  list: (opts: { search?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean; sortBy: string; sortDir: "asc" | "desc"; skip: number; take: number }) =>
    prisma.course.findMany({
      where: buildCourseWhere(opts),
      include,
      // `id desc` tiebreaker keeps newest on top when the primary column ties or is null.
      orderBy: buildCourseOrderBy(opts.sortBy, opts.sortDir),
      skip: opts.skip,
      take: opts.take,
    }),
  count: (opts: { search?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean }) =>
    prisma.course.count({ where: buildCourseWhere(opts) }),

  findById: (id: number) => prisma.course.findUnique({ where: { id }, include }),
  findBare: (id: number) => prisma.course.findUnique({ where: { id } }),
  exists: (id: number) => prisma.course.findUnique({ where: { id }, select: { id: true } }),

  materialCategoriesFor: (courseId: number) =>
    prisma.materialCategoryCourse.findMany({
      where: { courseId },
      include: { MaterialCategory: { select: { id: true, name: true, image: true } } },
      orderBy: { order: "asc" },
    }),
  examCategoriesFor: (courseId: number) =>
    prisma.examCategoryCourse.findMany({
      where: { courseId },
      include: { ExamCategory: { select: { id: true, name: true, image: true } } },
      orderBy: { order: "asc" },
    }),

  // Paginated category pivots for the course-detail tabs, ordered by the per-course
  // `order`; optional search on the linked category name.
  examCategoriesForPaged: (courseId: number, opts: { skip: number; take: number; search?: string }) =>
    prisma.examCategoryCourse.findMany({
      where: { courseId, ...examCatNameSearch(opts.search) },
      include: { ExamCategory: { select: { id: true, name: true, image: true, status: true } } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  countExamCategoriesFor: (courseId: number, search?: string) =>
    prisma.examCategoryCourse.count({
      where: { courseId, ...examCatNameSearch(search) },
    }),
  materialCategoriesForPaged: (courseId: number, opts: { skip: number; take: number; search?: string }) =>
    prisma.materialCategoryCourse.findMany({
      where: { courseId, ...materialCatNameSearch(opts.search) },
      include: { MaterialCategory: { select: { id: true, name: true, image: true, status: true } } },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  countMaterialCategoriesFor: (courseId: number, search?: string) =>
    prisma.materialCategoryCourse.count({
      where: { courseId, ...materialCatNameSearch(search) },
    }),

  // Course-detail "Material (Book)" tab, ordered by the per-course pivot `order`;
  // optional search on the book name.
  booksForPaged: (courseId: number, opts: { skip: number; take: number; search?: string }) =>
    prisma.courseBook.findMany({
      where: { courseId, ...courseBookNameSearch(opts.search) },
      include: { Book: true },
      orderBy: [{ order: "asc" }, { id: "asc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  countBooksFor: (courseId: number, search?: string) =>
    prisma.courseBook.count({
      where: { courseId, ...courseBookNameSearch(search) },
    }),

  existingBookIds: (bookIds: number[]) =>
    bookIds.length
      ? prisma.book.findMany({ where: { id: { in: bookIds } }, select: { id: true } })
      : Promise.resolve([] as { id: number }[]),
  linkedBookIds: (courseId: number, bookIds: number[]) =>
    bookIds.length
      ? prisma.courseBook.findMany({ where: { courseId, bookId: { in: bookIds } }, select: { bookId: true } })
      : Promise.resolve([] as { bookId: number | null }[]),
  /** New links append after this. */
  maxBookOrder: async (courseId: number): Promise<number> => {
    const top = await prisma.courseBook.findFirst({ where: { courseId }, orderBy: { order: "desc" }, select: { order: true } });
    return top?.order ?? 0;
  },
  createBookLinks: (rows: { courseId: number; bookId: number; order: number; created_at: Date; updated_at: Date }[]) =>
    prisma.courseBook.createMany({ data: rows }),
  reorderBookLinks: (courseId: number, items: { bookId: number; order: number }[], now: Date) =>
    prisma.$transaction(
      items.map((it) =>
        prisma.courseBook.updateMany({ where: { courseId, bookId: it.bookId }, data: { order: it.order, updated_at: now } })
      )
    ),
  unlinkBook: (courseId: number, bookId: number) =>
    prisma.courseBook.deleteMany({ where: { courseId, bookId } }),

  // One drag rewrites every visible row, so the batch runs as one sequential
  // transaction: concurrent updates on the same course_id rows deadlock in InnoDB.
  // Sorted by category id so concurrent requests lock rows in the same order.
  reorderExamCategoryLinks: (courseId: number, items: { categoryId: number; order: number }[], now: Date) =>
    prisma.$transaction(
      sortByCategoryId(items).map((it) =>
        prisma.examCategoryCourse.updateMany({ where: { courseId, examCategoryId: it.categoryId }, data: { order: it.order, updated_at: now } })
      )
    ),
  reorderMaterialCategoryLinks: (courseId: number, items: { categoryId: number; order: number }[], now: Date) =>
    prisma.$transaction(
      sortByCategoryId(items).map((it) =>
        prisma.materialCategoryCourse.updateMany({ where: { courseId, materialCategoryId: it.categoryId }, data: { order: it.order, updated_at: now } })
      )
    ),

  /** Course + its material/exam-category pivot rows in one transaction. */
  createCourse: (input: {
    data: Prisma.CourseUncheckedCreateInput;
    materialCategories: Array<{ categoryId: number; order: number }>;
    examCategories: Array<{ categoryId: number; order: number }>;
  }) =>
    prisma.$transaction(async (tx) => {
      const course = await tx.course.create({ data: input.data });
      await writePivots(tx, course.id, input.materialCategories, input.examCategories, { replace: false });
      return course;
    }),

  /** When a category array is provided, replaces that pivot set. */
  updateCourse: (
    id: number,
    data: Prisma.CourseUncheckedUpdateInput,
    pivots: { materialCategories?: Array<{ categoryId: number; order: number }>; examCategories?: Array<{ categoryId: number; order: number }> }
  ) =>
    prisma.$transaction(async (tx) => {
      const course = await tx.course.update({ where: { id }, data });
      if (pivots.materialCategories !== undefined) {
        await tx.materialCategoryCourse.deleteMany({ where: { courseId: id } });
        if (pivots.materialCategories.length) {
          await tx.materialCategoryCourse.createMany({ data: pivots.materialCategories.map((m) => ({ courseId: id, materialCategoryId: m.categoryId, order: m.order })) });
        }
      }
      if (pivots.examCategories !== undefined) {
        await tx.examCategoryCourse.deleteMany({ where: { courseId: id } });
        if (pivots.examCategories.length) {
          await tx.examCategoryCourse.createMany({ data: pivots.examCategories.map((e) => ({ courseId: id, examCategoryId: e.categoryId, order: e.order })) });
        }
      }
      return course;
    }),

  deleteCourse: (id: number) =>
    prisma.$transaction(async (tx) => {
      const plans = await tx.packageCourseEbookPrice.deleteMany({ where: { courseId: id } });
      await tx.materialCategoryCourse.deleteMany({ where: { courseId: id } });
      await tx.examCategoryCourse.deleteMany({ where: { courseId: id } });
      await tx.course.delete({ where: { id } });
      return { deletedPlans: plans.count };
    }),

  setPopular: (id: number, isPopular: boolean) =>
    prisma.course.update({ where: { id }, data: { is_featured: isPopular ? "yes" : "no", updatedAt: new Date() } }),

  setStatus: (id: number, status: boolean) =>
    prisma.course.update({ where: { id }, data: { status, updatedAt: new Date() } }),

  // ws_package_course_ebook_price is shared. A course-owned plan has packageId=0 AND
  // ebookId=0 (as createPlan writes), so never surface package/ebook/combo rows here.
  listPlans: (courseId: number, skip?: number, take?: number) =>
    prisma.packageCourseEbookPrice.findMany({
      where: { courseId, packageId: 0, ebookId: 0 },
      orderBy: [{ isDefault: "desc" }, { created_at: "desc" }],
      ...(skip !== undefined ? { skip } : {}),
      ...(take !== undefined ? { take } : {}),
    }),
  countPlans: (courseId: number) =>
    prisma.packageCourseEbookPrice.count({ where: { courseId, packageId: 0, ebookId: 0 } }),
  findPlanById: (id: number) => prisma.packageCourseEbookPrice.findUnique({ where: { id } }),
  createPlan: (data: Prisma.PackageCourseEbookPriceUncheckedCreateInput) => prisma.packageCourseEbookPrice.create({ data }),
  updatePlan: (id: number, data: Prisma.PackageCourseEbookPriceUncheckedUpdateInput) => prisma.packageCourseEbookPrice.update({ where: { id }, data }),
  /**
   * Promo-code plan links point at ws_package_course_ebook_price.id with no FK, so a
   * plan delete must clear them or they orphan (same as admin-plan.deletePlan).
   */
  deletePromotedForPlan: (planId: number) =>
    prisma.promotedPackageCourseEbook.deleteMany({ where: { planId } }),
  deletePlan: (id: number) => prisma.packageCourseEbookPrice.delete({ where: { id } }),
  /** Single-default invariant: sets every other course-owned plan to isDefault=false. */
  clearSiblingDefaults: (courseId: number, exceptId: number) =>
    prisma.packageCourseEbookPrice.updateMany({ where: { courseId, packageId: 0, ebookId: 0, id: { not: exceptId } }, data: { isDefault: false } }),

  activeEducators: () => prisma.courseEducator.findMany({ where: { status: true }, select: { id: true, name: true } }),
  activeSubjectCategories: () => prisma.courseSubjectCategory.findMany({ where: { status: true }, select: { id: true, title: true } }),
  activeVideoCategories: () => prisma.videoCategory.findMany({ where: { status: true }, select: { id: true, title: true } }),
  allMaterials: () => prisma.packageCourseMaterial.findMany({ select: { id: true, title: true } }),

  listVideoCategories: (opts: { skip: number; take: number }) =>
    prisma.videoCategory.findMany({ where: { status: true }, orderBy: [{ order_by: "asc" }, { created_at: "desc" }, { id: "desc" }], skip: opts.skip, take: opts.take }),
  countVideoCategories: () => prisma.videoCategory.count({ where: { status: true } }),
  findVideoCategoryBare: (id: number) => prisma.videoCategory.findUnique({ where: { id } }),
  createVideoCategory: (data: Prisma.VideoCategoryUncheckedCreateInput) => prisma.videoCategory.create({ data }),
  updateVideoCategory: (id: number, data: Prisma.VideoCategoryUncheckedUpdateInput) => prisma.videoCategory.update({ where: { id }, data }),
  deleteVideoCategory: (id: number) => prisma.videoCategory.delete({ where: { id } }),
  videoCategoryUsedByCourse: (id: number) => prisma.course.findFirst({ where: { videoCategoryId: id }, select: { id: true } }),
  deleteRelationsForCategory: (id: number) => prisma.videoCategoryRelation.deleteMany({ where: { OR: [{ parent: id }, { child: id }] } }),

  listMaterials: (opts: { skip: number; take: number }) =>
    prisma.packageCourseMaterial.findMany({ orderBy: { created_at: "desc" }, skip: opts.skip, take: opts.take }),
  countMaterials: () => prisma.packageCourseMaterial.count(),
  findMaterialBare: (id: number) => prisma.packageCourseMaterial.findUnique({ where: { id } }),
  createMaterial: (data: Prisma.PackageCourseMaterialUncheckedCreateInput) => prisma.packageCourseMaterial.create({ data }),
  updateMaterial: (id: number, data: Prisma.PackageCourseMaterialUncheckedUpdateInput) => prisma.packageCourseMaterial.update({ where: { id }, data }),
  deleteMaterial: (id: number) => prisma.packageCourseMaterial.delete({ where: { id } }),

  listRelations: (opts: { skip: number; take: number }) =>
    prisma.videoCategoryRelation.findMany({
      include: { childVideoCategory: { select: { id: true, title: true, slug: true } } },
      orderBy: [{ order: "asc" }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  countRelations: () => prisma.videoCategoryRelation.count(),
  findRelationBare: (id: number) => prisma.videoCategoryRelation.findUnique({ where: { id } }),
  relationExists: (parent: number, child: number) => prisma.videoCategoryRelation.findFirst({ where: { parent, child }, select: { id: true } }),
  createRelation: (data: Prisma.VideoCategoryRelationUncheckedCreateInput) => prisma.videoCategoryRelation.create({ data }),
  updateRelation: (id: number, order: number) => prisma.videoCategoryRelation.update({ where: { id }, data: { order } }),
  deleteRelation: (id: number) => prisma.videoCategoryRelation.delete({ where: { id } }),
};

async function writePivots(
  tx: Prisma.TransactionClient,
  courseId: number,
  materialCategories: Array<{ categoryId: number; order: number }>,
  examCategories: Array<{ categoryId: number; order: number }>,
  _opts: { replace: boolean }
) {
  if (materialCategories.length) {
    await tx.materialCategoryCourse.createMany({ data: materialCategories.map((m) => ({ courseId, materialCategoryId: m.categoryId, order: m.order })) });
  }
  if (examCategories.length) {
    await tx.examCategoryCourse.createMany({ data: examCategories.map((e) => ({ courseId, examCategoryId: e.categoryId, order: e.order })) });
  }
}

/**
 * Recency is the contract (utils/listOrdering): sortBy "order" (the UI default) maps
 * to `createdAt DESC, id DESC` and ignores sortDir on purpose. Other sortBy values use
 * their own column and direction. `ws_course.ordered` still drives the client catalog.
 */
function buildCourseOrderBy(sortBy: string, sortDir: "asc" | "desc"): Prisma.CourseOrderByWithRelationInput[] {
  if (!sortBy || sortBy === "order" || sortBy === "ordered" || sortBy === "order_by")
    return [{ createdAt: "desc" }, { id: "desc" }];
  return [{ [courseSortCol(sortBy)]: sortDir }, { id: "desc" }];
}

function courseSortCol(sortBy: string): string {
  if (sortBy === "name") return "name";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updatedAt";
  if (sortBy === "createdAt" || sortBy === "created_at") return "createdAt";
  // "order" never reaches here; buildCourseOrderBy intercepts it.
  return "createdAt";
}

function buildCourseWhere(opts: { search?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean }): Prisma.CourseWhereInput {
  const where: Prisma.CourseWhereInput = {};
  // Unanchored `contains`: no index on name/description, and a prefix anchor dropped
  // mid-title matches.
  const search = buildPrismaSearch(opts.search, ["name", "description"]);
  if (search) Object.assign(where, search);
  if (opts.status !== undefined) where.status = opts.status;
  // purchase enum: isPaid defaults true, so only explicit "no" is unpaid.
  if (opts.isPaid === true) where.purchase = { not: "no" };
  else if (opts.isPaid === false) where.purchase = "no";
  // Only explicit "yes" is popular.
  if (opts.isPopular === true) where.is_featured = "yes";
  else if (opts.isPopular === false) where.is_featured = { not: "yes" };
  return where;
}
