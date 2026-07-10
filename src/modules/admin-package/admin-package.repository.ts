import { prisma } from "../../config/prisma";
import type { Prisma } from "@prisma/client";

/**
 * Prisma persistence for the admin-package MySQL branch.
 *  - types          → ws_package_type (id/name only — NO order/active columns)
 *  - packages       → ws_package
 *  - specificSubjects[] → ws_package_specific_subject (subject_id → VideoCategory)
 *  - materialCategories[] → ws_material_category_package (mcategory_id → MaterialCategory)
 *  - examCategories[] → ws_exam_category_package (exam_category_id → ExamCategory)
 *  - plans          → ws_package_course_ebook_price (package-owned; shared table)
 *  - subscribers    → ws_package_course_subscription (package_id = the package)
 *  - video relations→ ws_video_category_package_relation
 *
 * ⚠ Drift: ws_package has NO column for subtitle, notificationTopic, or the
 * examCountdown* arrays. It DOES have is_paid
 * and package_category_id (all wired through service write/read).
 * SQL has exam_id (→ goal), educator_id, package_type_id, goal_id and
 * goal_label_id (the latter stores the goal's JSON-label numeric id; the API
 * boundary resolves it to/from the label NAME). with_material/without_material
 * are descriptive VARCHAR text. package_type_id / exam_id are NOT NULL →
 * sentinels on write.
 */
const pkgInclude = { packageType: { select: { id: true, name: true } } };

export const adminPackageRepository = {
  // ── package types ─────────────────────────────────────────────────────────
  listTypes: () => prisma.packageType.findMany({ orderBy: [{ name: "asc" }] }),
  findTypeBare: (id: number) => prisma.packageType.findUnique({ where: { id } }),
  createType: (data: Prisma.PackageTypeUncheckedCreateInput) => prisma.packageType.create({ data }),
  updateType: (id: number, data: Prisma.PackageTypeUncheckedUpdateInput) => prisma.packageType.update({ where: { id }, data }),
  deleteType: (id: number) => prisma.packageType.delete({ where: { id } }),
  typeInUse: (id: number) => prisma.package.findFirst({ where: { packageTypeId: id }, select: { id: true } }),

  // ── packages: list / get ────────────────────────────────────────────────────
  list: (opts: { search?: string; active?: boolean; packageTypeId?: number; skip: number; take: number }) =>
    prisma.package.findMany({ where: buildWhere(opts), include: pkgInclude, orderBy: { created_at: "desc" }, skip: opts.skip, take: opts.take }),
  count: (opts: { search?: string; active?: boolean; packageTypeId?: number }) => prisma.package.count({ where: buildWhere(opts) }),
  findById: (id: number) => prisma.package.findUnique({ where: { id }, include: pkgInclude }),
  findBare: (id: number) => prisma.package.findUnique({ where: { id } }),
  exists: (id: number) => prisma.package.findUnique({ where: { id }, select: { id: true } }),

  // ── goal labels (JSON [{ id, name }] on ws_customer_target_goal) — name↔id ─────
  goalById: (id: number) => prisma.customerTargetGoal.findUnique({ where: { id }, select: { id: true, labels: true } }),
  goalsByIds: (ids: number[]) =>
    ids.length ? prisma.customerTargetGoal.findMany({ where: { id: { in: ids } }, select: { id: true, labels: true } }) : Promise.resolve([]),

  /** Active plans for a set of packages (list-row pricing buckets). */
  plansForPackages: (packageIds: number[]) =>
    packageIds.length
      ? prisma.packageCourseEbookPrice.findMany({ where: { packageId: { in: packageIds }, status: true }, orderBy: { duration: "asc" } })
      : Promise.resolve([]),

  // ── embedded category pivots ──────────────────────────────────────────────────
  specificSubjectsFor: (packageId: number) =>
    prisma.packageSpecificSubject.findMany({ where: { packageId }, include: { VideoCategory: { select: { id: true, title: true, image: true } } }, orderBy: { order_by: "asc" } }),
  materialCategoriesFor: (packageId: number) =>
    prisma.materialCategoryPackage.findMany({ where: { packageId }, include: { MaterialCategory: { select: { id: true, name: true, image: true } } }, orderBy: { order: "asc" } }),
  examCategoriesFor: (packageId: number) =>
    prisma.examCategoryPackage.findMany({ where: { packageId }, include: { ExamCategory: { select: { id: true, name: true, image: true } } }, orderBy: { order: "asc" } }),

  // Paginated variants of the three category pivots for the package-detail tabs
  // (same include/orderBy as the embedded-array loaders above; add skip/take + count).
  specificSubjectsForPaged: (packageId: number, skip: number, take: number) =>
    prisma.packageSpecificSubject.findMany({ where: { packageId }, include: { VideoCategory: { select: { id: true, title: true, image: true } } }, orderBy: { order_by: "asc" }, skip, take }),
  countSpecificSubjectsFor: (packageId: number) =>
    prisma.packageSpecificSubject.count({ where: { packageId } }),
  materialCategoriesForPaged: (packageId: number, skip: number, take: number) =>
    prisma.materialCategoryPackage.findMany({ where: { packageId }, include: { MaterialCategory: { select: { id: true, name: true, image: true } } }, orderBy: { order: "asc" }, skip, take }),
  countMaterialCategoriesFor: (packageId: number) =>
    prisma.materialCategoryPackage.count({ where: { packageId } }),
  examCategoriesForPaged: (packageId: number, skip: number, take: number) =>
    prisma.examCategoryPackage.findMany({ where: { packageId }, include: { ExamCategory: { select: { id: true, name: true, image: true } } }, orderBy: { order: "asc" }, skip, take }),
  countExamCategoriesFor: (packageId: number) =>
    prisma.examCategoryPackage.count({ where: { packageId } }),

  // ── packages: write ───────────────────────────────────────────────────────────
  createPackage: (input: {
    data: Prisma.PackageUncheckedCreateInput;
    specificSubjects: Array<{ id: number; order: number; status: boolean }>;
    materialCategories: Array<{ id: number; order: number }>;
    examCategories: Array<{ id: number; order: number }>;
  }) =>
    prisma.$transaction(async (tx) => {
      const pkg = await tx.package.create({ data: input.data });
      await replacePivots(tx, pkg.id, input);
      return pkg;
    }),

  updatePackage: (
    id: number,
    data: Prisma.PackageUncheckedUpdateInput,
    pivots: {
      specificSubjects?: Array<{ id: number; order: number; status: boolean }>;
      materialCategories?: Array<{ id: number; order: number }>;
      examCategories?: Array<{ id: number; order: number }>;
    }
  ) =>
    prisma.$transaction(async (tx) => {
      const pkg = await tx.package.update({ where: { id }, data });
      if (pivots.specificSubjects !== undefined) {
        await tx.packageSpecificSubject.deleteMany({ where: { packageId: id } });
        if (pivots.specificSubjects.length)
          await tx.packageSpecificSubject.createMany({ data: pivots.specificSubjects.map((s) => ({ packageId: id, subjectId: s.id, order_by: s.order, status: s.status })) });
      }
      if (pivots.materialCategories !== undefined) {
        await tx.materialCategoryPackage.deleteMany({ where: { packageId: id } });
        if (pivots.materialCategories.length)
          await tx.materialCategoryPackage.createMany({ data: pivots.materialCategories.map((m) => ({ packageId: id, materialCategoryId: m.id, order: m.order })) });
      }
      if (pivots.examCategories !== undefined) {
        await tx.examCategoryPackage.deleteMany({ where: { packageId: id } });
        if (pivots.examCategories.length)
          await tx.examCategoryPackage.createMany({ data: pivots.examCategories.map((e) => ({ packageId: id, examCategoryId: e.id, order: e.order })) });
      }
      return pkg;
    }),

  deletePackage: (id: number) =>
    prisma.$transaction(async (tx) => {
      await tx.packageVideoCategoryRelation.deleteMany({ where: { packageId: id } });
      await tx.packageChat.deleteMany({ where: { packageId: id } });
      await tx.packageSpecificSubject.deleteMany({ where: { packageId: id } });
      await tx.materialCategoryPackage.deleteMany({ where: { packageId: id } });
      await tx.examCategoryPackage.deleteMany({ where: { packageId: id } });
      // Detach plans (don't orphan a subscriber's plan row): null the package + status off.
      await tx.packageCourseEbookPrice.updateMany({ where: { packageId: id }, data: { packageId: null, status: false } });
      await tx.package.delete({ where: { id } });
    }),

  setActive: (id: number, active: boolean) => prisma.package.update({ where: { id }, data: { active, updated_at: new Date() } }),
  setOrder: (id: number, order: number) => prisma.package.update({ where: { id }, data: { order_by: order, updated_at: new Date() } }),
  subscriberCount: (packageId: number) => prisma.packageCourseSubscription.count({ where: { packageId } }),

  // ── embedded reorder (in place) ─────────────────────────────────────────────
  reorderSpecificSubject: (packageId: number, subjectId: number, order: number) =>
    prisma.packageSpecificSubject.updateMany({ where: { packageId, subjectId }, data: { order_by: order } }),
  reorderMaterialCategory: (packageId: number, materialCategoryId: number, order: number) =>
    prisma.materialCategoryPackage.updateMany({ where: { packageId, materialCategoryId }, data: { order } }),
  reorderExamCategory: (packageId: number, examCategoryId: number, order: number) =>
    prisma.examCategoryPackage.updateMany({ where: { packageId, examCategoryId }, data: { order } }),

  // ── plans ────────────────────────────────────────────────────────────────────
  listPlans: (packageId: number, skip?: number, take?: number) => prisma.packageCourseEbookPrice.findMany({ where: { packageId, status: true }, orderBy: { duration: "asc" }, skip, take }),
  countPlans: (packageId: number) => prisma.packageCourseEbookPrice.count({ where: { packageId, status: true } }),
  attachPlans: (packageId: number, planIds: number[]) =>
    prisma.packageCourseEbookPrice.updateMany({ where: { id: { in: planIds } }, data: { packageId, courseId: 0, ebookId: 0 } }),
  detachPlan: (packageId: number, planId: number) =>
    prisma.packageCourseEbookPrice.updateMany({ where: { id: planId, packageId }, data: { status: false } }),

  // ── subscribers ───────────────────────────────────────────────────────────────
  listSubscribers: (packageId: number, skip: number, take: number) =>
    prisma.packageCourseSubscription.findMany({
      where: { packageId },
      include: { customer: { select: { id: true, fullName: true, phoneNumber: true, emailAddress: true } }, package: { select: { id: true, name: true } } },
      orderBy: { id: "desc" },
      skip, take,
    }),
  countSubscribers: (packageId: number) => prisma.packageCourseSubscription.count({ where: { packageId } }),

  // ── video category relations ────────────────────────────────────────────────
  listVideoRelations: (packageId: number) =>
    prisma.packageVideoCategoryRelation.findMany({ where: { packageId } }),
  /** Set the package's active relation set: deactivate all, then upsert each id active. */
  setVideoRelations: (packageId: number, relationIds: number[]) =>
    prisma.$transaction(async (tx) => {
      await tx.packageVideoCategoryRelation.updateMany({ where: { packageId }, data: { status: false } });
      for (const rid of relationIds) {
        const existing = await tx.packageVideoCategoryRelation.findFirst({ where: { packageId, videoCategoryRelationId: rid }, select: { id: true } });
        if (existing) await tx.packageVideoCategoryRelation.update({ where: { id: existing.id }, data: { status: true } });
        else await tx.packageVideoCategoryRelation.create({ data: { packageId, videoCategoryRelationId: rid, status: true, updated_at: new Date() } });
      }
      return relationIds.length;
    }),

  /** BFS roots = the package's specificSubjects subject ids. */
  specificSubjectIds: async (packageId: number): Promise<number[]> => {
    const rows = await prisma.packageSpecificSubject.findMany({ where: { packageId }, select: { subjectId: true } });
    return rows.map((r) => r.subjectId).filter((s): s is number => s != null);
  },
  relationsByParents: (parents: number[]) =>
    parents.length ? prisma.videoCategoryRelation.findMany({ where: { parent: { in: parents } }, select: { id: true, child: true } }) : Promise.resolve([]),
};

async function replacePivots(
  tx: Prisma.TransactionClient,
  packageId: number,
  input: {
    specificSubjects: Array<{ id: number; order: number; status: boolean }>;
    materialCategories: Array<{ id: number; order: number }>;
    examCategories: Array<{ id: number; order: number }>;
  }
) {
  if (input.specificSubjects.length)
    await tx.packageSpecificSubject.createMany({ data: input.specificSubjects.map((s) => ({ packageId, subjectId: s.id, order_by: s.order, status: s.status })) });
  if (input.materialCategories.length)
    await tx.materialCategoryPackage.createMany({ data: input.materialCategories.map((m) => ({ packageId, materialCategoryId: m.id, order: m.order })) });
  if (input.examCategories.length)
    await tx.examCategoryPackage.createMany({ data: input.examCategories.map((e) => ({ packageId, examCategoryId: e.id, order: e.order })) });
}

function buildWhere(opts: { search?: string; active?: boolean; packageTypeId?: number }): Prisma.PackageWhereInput {
  const where: Prisma.PackageWhereInput = {};
  if (opts.search) where.name = { contains: opts.search.trim() };
  if (opts.active !== undefined) where.active = opts.active;
  if (opts.packageTypeId !== undefined) where.packageTypeId = opts.packageTypeId;
  return where;
}
