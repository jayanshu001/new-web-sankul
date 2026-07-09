import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-course MySQL branch.
 *  - courses        → ws_course (+ educator/subject/videoCategory/pcMaterial FKs)
 *  - plans          → ws_package_course_ebook_price (course-owned; shared table)
 *  - material cats  → ws_material_category_course pivot (Mongo embedded
 *                     materialCategories[])
 *  - exam cats      → ws_exam_category_course pivot (Mongo embedded examCategories[])
 *  - video cats     → ws_video_category (global; ⚠ NO course_id column)
 *  - vcat relations → ws_video_category_relation
 *  - materials      → ws_package_course_material (title-only)
 *
 * ⚠ Drift: ws_video_category has NO course_id → course-scoped folders + the
 * createCourse Root-folder automation are NOT representable (skipped on SQL,
 * user-approved). course_category_id / educator_id are NOT NULL → 0 sentinel.
 * with_material/without_material/level are varchar in SQL (not bool).
 */
const include = {
  educator: { select: { id: true, name: true } },
  subject: { select: { id: true, title: true } },
  VideoCategory: { select: { id: true, title: true } },
};

export const adminCourseRepository = {
  // ── courses: list / get ────────────────────────────────────────────────────
  list: (opts: { search?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean; sortBy: string; sortDir: "asc" | "desc"; skip: number; take: number }) =>
    prisma.course.findMany({
      where: buildCourseWhere(opts),
      include,
      // `id desc` tiebreaker so newest-added stays on top even when the primary
      // column ties or is null (migrated rows). Default sort is createdAt desc.
      orderBy: [{ [courseSortCol(opts.sortBy)]: opts.sortDir }, { id: "desc" }],
      skip: opts.skip,
      take: opts.take,
    }),
  count: (opts: { search?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean }) =>
    prisma.course.count({ where: buildCourseWhere(opts) }),

  findById: (id: number) => prisma.course.findUnique({ where: { id }, include }),
  findBare: (id: number) => prisma.course.findUnique({ where: { id } }),
  exists: (id: number) => prisma.course.findUnique({ where: { id }, select: { id: true } }),

  /** Material/exam category pivots for a course, with the linked category meta. */
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

  // Paginated category-pivot lists for the admin course-detail tabs. Resolved rows
  // (category meta incl. status) ordered by the course-specific `order`; optional
  // case-insensitive search on the linked category name.
  examCategoriesForPaged: (courseId: number, opts: { skip: number; take: number; search?: string }) =>
    prisma.examCategoryCourse.findMany({
      where: { courseId, ...(opts.search ? { ExamCategory: { name: { contains: opts.search } } } : {}) },
      include: { ExamCategory: { select: { id: true, name: true, image: true, status: true } } },
      orderBy: { order: "asc" },
      skip: opts.skip,
      take: opts.take,
    }),
  countExamCategoriesFor: (courseId: number, search?: string) =>
    prisma.examCategoryCourse.count({
      where: { courseId, ...(search ? { ExamCategory: { name: { contains: search } } } : {}) },
    }),
  materialCategoriesForPaged: (courseId: number, opts: { skip: number; take: number; search?: string }) =>
    prisma.materialCategoryCourse.findMany({
      where: { courseId, ...(opts.search ? { MaterialCategory: { name: { contains: opts.search } } } : {}) },
      include: { MaterialCategory: { select: { id: true, name: true, image: true, status: true } } },
      orderBy: { order: "asc" },
      skip: opts.skip,
      take: opts.take,
    }),
  countMaterialCategoriesFor: (courseId: number, search?: string) =>
    prisma.materialCategoryCourse.count({
      where: { courseId, ...(search ? { MaterialCategory: { name: { contains: search } } } : {}) },
    }),

  // Physical books linked to a course (Course-Detail "Material (Book)" tab), with
  // the joined ws_book meta, ordered by the per-course pivot `order`; optional
  // case-insensitive search on the linked book name.
  booksForPaged: (courseId: number, opts: { skip: number; take: number; search?: string }) =>
    prisma.courseBook.findMany({
      where: { courseId, ...(opts.search ? { Book: { name: { contains: opts.search } } } : {}) },
      include: { Book: true },
      orderBy: { order: "asc" },
      skip: opts.skip,
      take: opts.take,
    }),
  countBooksFor: (courseId: number, search?: string) =>
    prisma.courseBook.count({
      where: { courseId, ...(search ? { Book: { name: { contains: search } } } : {}) },
    }),

  // ── course ↔ book link write ─────────────────────────────────────────────────
  /** Which of the given book ids actually exist in ws_book. */
  existingBookIds: (bookIds: number[]) =>
    bookIds.length
      ? prisma.book.findMany({ where: { id: { in: bookIds } }, select: { id: true } })
      : Promise.resolve([] as { id: number }[]),
  /** Book ids already linked to this course (to skip duplicates on attach). */
  linkedBookIds: (courseId: number, bookIds: number[]) =>
    bookIds.length
      ? prisma.courseBook.findMany({ where: { courseId, bookId: { in: bookIds } }, select: { bookId: true } })
      : Promise.resolve([] as { bookId: number | null }[]),
  /** Current highest per-course order (new links append after it). */
  maxBookOrder: async (courseId: number): Promise<number> => {
    const top = await prisma.courseBook.findFirst({ where: { courseId }, orderBy: { order: "desc" }, select: { order: true } });
    return top?.order ?? 0;
  },
  createBookLinks: (rows: { courseId: number; bookId: number; order: number; created_at: Date; updated_at: Date }[]) =>
    prisma.courseBook.createMany({ data: rows }),
  /** Reorder already-linked books; each update scoped to (courseId, bookId). */
  reorderBookLinks: (courseId: number, items: { bookId: number; order: number }[], now: Date) =>
    prisma.$transaction(
      items.map((it) =>
        prisma.courseBook.updateMany({ where: { courseId, bookId: it.bookId }, data: { order: it.order, updated_at: now } })
      )
    ),
  unlinkBook: (courseId: number, bookId: number) =>
    prisma.courseBook.deleteMany({ where: { courseId, bookId } }),

  // ── courses: write ──────────────────────────────────────────────────────────
  /** Create course + its material/exam-category pivot rows in one txn. */
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

  /** Update course; when a category array is provided, replace that pivot set. */
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

  /** Delete course + cascade plans + pivot rows (no courseId folder cleanup — see drift note). */
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

  // ── plans (course-owned price rows) ─────────────────────────────────────────
  // ws_package_course_ebook_price is shared (package/course/ebook). A course-OWNED
  // plan has packageId=0 AND ebookId=0 (createPlan writes exactly that), so scope to
  // those — never surface package/ebook (or course+ebook combo) rows under a course.
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
  deletePlan: (id: number) => prisma.packageCourseEbookPrice.delete({ where: { id } }),
  /** Single-default invariant: flip all OTHER course-owned plans to isDefault=false. */
  clearSiblingDefaults: (courseId: number, exceptId: number) =>
    prisma.packageCourseEbookPrice.updateMany({ where: { courseId, packageId: 0, ebookId: 0, id: { not: exceptId } }, data: { isDefault: false } }),

  // ── pre-requisites ──────────────────────────────────────────────────────────
  activeEducators: () => prisma.courseEducator.findMany({ where: { status: true }, select: { id: true, name: true } }),
  activeSubjectCategories: () => prisma.courseSubjectCategory.findMany({ where: { status: true }, select: { id: true, title: true } }),
  activeVideoCategories: () => prisma.videoCategory.findMany({ where: { status: true }, select: { id: true, title: true } }),
  allMaterials: () => prisma.packageCourseMaterial.findMany({ select: { id: true, title: true } }),

  // ── video categories (global ws_video_category — courseId scope dropped) ──────
  listVideoCategories: (opts: { skip: number; take: number }) =>
    prisma.videoCategory.findMany({ where: { status: true }, orderBy: [{ order_by: "asc" }, { created_at: "desc" }], skip: opts.skip, take: opts.take }),
  countVideoCategories: () => prisma.videoCategory.count({ where: { status: true } }),
  findVideoCategoryBare: (id: number) => prisma.videoCategory.findUnique({ where: { id } }),
  createVideoCategory: (data: Prisma.VideoCategoryUncheckedCreateInput) => prisma.videoCategory.create({ data }),
  updateVideoCategory: (id: number, data: Prisma.VideoCategoryUncheckedUpdateInput) => prisma.videoCategory.update({ where: { id }, data }),
  deleteVideoCategory: (id: number) => prisma.videoCategory.delete({ where: { id } }),
  videoCategoryUsedByCourse: (id: number) => prisma.course.findFirst({ where: { videoCategoryId: id }, select: { id: true } }),
  deleteRelationsForCategory: (id: number) => prisma.videoCategoryRelation.deleteMany({ where: { OR: [{ parent: id }, { child: id }] } }),

  // ── materials (pc-material; title-only) ──────────────────────────────────────
  listMaterials: (opts: { skip: number; take: number }) =>
    prisma.packageCourseMaterial.findMany({ orderBy: { created_at: "desc" }, skip: opts.skip, take: opts.take }),
  countMaterials: () => prisma.packageCourseMaterial.count(),
  findMaterialBare: (id: number) => prisma.packageCourseMaterial.findUnique({ where: { id } }),
  createMaterial: (data: Prisma.PackageCourseMaterialUncheckedCreateInput) => prisma.packageCourseMaterial.create({ data }),
  updateMaterial: (id: number, data: Prisma.PackageCourseMaterialUncheckedUpdateInput) => prisma.packageCourseMaterial.update({ where: { id }, data }),
  deleteMaterial: (id: number) => prisma.packageCourseMaterial.delete({ where: { id } }),

  // ── video category relations ─────────────────────────────────────────────────
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

function courseSortCol(sortBy: string): string {
  if (sortBy === "name") return "name";
  if (sortBy === "order" || sortBy === "ordered" || sortBy === "order_by") return "ordered";
  if (sortBy === "updatedAt" || sortBy === "updated_at") return "updatedAt";
  return "createdAt";
}

function buildCourseWhere(opts: { search?: string; status?: boolean; isPaid?: boolean; isPopular?: boolean }): Prisma.CourseWhereInput {
  const where: Prisma.CourseWhereInput = {};
  if (opts.search) {
    const q = opts.search.trim();
    where.OR = [{ name: { contains: q } }, { description: { contains: q } }];
  }
  if (opts.status !== undefined) where.status = opts.status;
  // purchase enum('0','1'): Mongo isPaid defaults TRUE → only explicit '0' is unpaid.
  if (opts.isPaid === true) where.purchase = { not: "no" };
  else if (opts.isPaid === false) where.purchase = "no";
  // is_featured enum: only explicit '1' (yes) is popular.
  if (opts.isPopular === true) where.is_featured = "yes";
  else if (opts.isPopular === false) where.is_featured = { not: "yes" };
  return where;
}
