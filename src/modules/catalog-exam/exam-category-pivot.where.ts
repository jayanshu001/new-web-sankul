// Exam categories: pivot-aware exam filters and multi-category assignment.
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

/** Match exams by primary `exam_category_id` OR `ws_exam_category_pivot` link. */
export const examInCategoriesWhere = (categoryIds: number[]): Prisma.ExamWhereInput => {
  if (categoryIds.length === 0) return { id: -1 };
  if (categoryIds.length === 1) {
    const id = categoryIds[0]!;
    return {
      OR: [
        { examCategoryId: id },
        { examCategoryPivot: { some: { categoryId: id } } },
      ],
    };
  }
  return {
    OR: [
      { examCategoryId: { in: categoryIds } },
      { examCategoryPivot: { some: { categoryId: { in: categoryIds } } } },
    ],
  };
};

export const examInCategoryWhere = (categoryId: number): Prisma.ExamWhereInput =>
  examInCategoriesWhere([categoryId]);

/**
 * Subject exams are hidden until their start date; NULL `start_date` means always
 * available. AND-merge with `{ status: true, type: "subject" }`.
 */
export const subjectStartedWhere = (now: Date): Prisma.ExamWhereInput => ({
  OR: [{ startAt: null }, { startAt: { lte: now } }],
});

/**
 * All category ids at or below `rootId` (self + descendants), via the self-FK tree.
 * Category filters must expand through this: a pivot row records only the leaf the
 * exam was filed under, so matching a parent id against the pivot finds nothing.
 * New callers should use this rather than another local copy of the walk.
 */
export const descendantExamCategoryIds = async (rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${rootId} UNION SELECT c.id FROM ws_exam_category c JOIN tree t ON c.parent_id = t.id) SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

/**
 * Each id must exist (not soft-deleted) and be a leaf; the admin picker only offers
 * leaves. Returns the first problem as a message, or null. An empty set is valid
 * here; whether it is allowed is decided by requireCategoryForType in admin-exam.service.
 */
export const validateLeafCategoryIds = async (categoryIds: number[]): Promise<string | null> => {
  const unique = [...new Set(categoryIds)];
  if (!unique.length) return null;

  const found = await prisma.examCategory.findMany({
    where: { id: { in: unique }, deleted: false },
    select: { id: true },
  });
  const exists = new Set(found.map((c) => c.id));
  const missing = unique.find((id) => !exists.has(id));
  if (missing !== undefined) return `Category ${missing} not found`;

  const parents = await prisma.examCategory.findMany({
    where: { parent: { in: unique }, deleted: false },
    select: { parent: true },
    distinct: ["parent"],
  });
  const nonLeaf = parents[0]?.parent;
  if (nonLeaf !== undefined) return `Category ${nonLeaf} is not a leaf category`;

  return null;
};

/**
 * Full-replace an exam's category links with exactly `categoryIds` (deduped).
 *
 * The pivot holds only the categories an admin chose, never ancestors, so the edit
 * modal can read the selection back; parent lookups expand the tree at read time
 * (see descendantExamCategoryIds). Existing rows are left untouched (preserving
 * created_at). An empty set clears all links; whether that is allowed is the
 * caller's decision (requireCategoryForType in admin-exam.service).
 */
export const setExamCategories = async (
  examId: number,
  categoryIds: number[]
): Promise<void> => {
  const unique = [...new Set(categoryIds)];
  if (!unique.length) {
    await prisma.examCategoryPivot.deleteMany({ where: { examId } });
    return;
  }

  const now = new Date();
  await prisma.$transaction([
    prisma.examCategoryPivot.deleteMany({ where: { examId, categoryId: { notIn: unique } } }),
    prisma.examCategoryPivot.createMany({
      data: unique.map((categoryId) => ({
        examId,
        categoryId,
        created_at: now,
        updated_at: now,
      })),
      skipDuplicates: true,
    }),
  ]);
};
