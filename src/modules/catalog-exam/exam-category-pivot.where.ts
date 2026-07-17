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
 * Subject-type exams are only visible once their start date has arrived; a NULL
 * `start_date` means "no schedule" → always available. Pair this with
 * `{ status: true, type: "subject" }` so scheduled-for-later subject exams are
 * excluded from client catalog counts + test lists (they should not appear until
 * they start). AND-merge into the exam filter.
 */
export const subjectStartedWhere = (now: Date): Prisma.ExamWhereInput => ({
  OR: [{ startAt: null }, { startAt: { lte: now } }],
});

/** AND-merge category match into an existing exam filter. */
export const withExamInCategories = (
  base: Prisma.ExamWhereInput,
  categoryIds: number[]
): Prisma.ExamWhereInput => ({
  AND: [base, examInCategoriesWhere(categoryIds)],
});

/**
 * All category ids at or below `rootId` (self + descendants), via the self-FK tree.
 *
 * Read sites that filter exams by a category MUST expand through this: a pivot row
 * records only the category an admin actually filed the exam under (a leaf), never
 * its ancestors, so matching a parent id against the pivot directly finds nothing.
 * Callers that already expand (client-catalog, catalog-course, catalog-package)
 * keep their local copies of this walk; new callers should use this one.
 */
export const descendantExamCategoryIds = async (rootId: number): Promise<number[]> => {
  const rows = await prisma.$queryRawUnsafe<{ id: number }[]>(
    `WITH RECURSIVE tree (id) AS (SELECT ${rootId} UNION SELECT c.id FROM ws_exam_category c JOIN tree t ON c.parent_id = t.id) SELECT id FROM tree`
  );
  return rows.map((r) => Number(r.id));
};

/** Exams filed under `categoryId` OR any category beneath it. */
export const examInCategorySubtreeWhere = async (
  categoryId: number
): Promise<Prisma.ExamWhereInput> =>
  examInCategoriesWhere(await descendantExamCategoryIds(categoryId));

/**
 * Validate a set of category ids for a write: each must exist (and not be
 * soft-deleted) and each must be a LEAF. The admin picker only offers leaves, so a
 * non-leaf id reaching here means a hand-rolled request. Returns the first problem
 * as a message, or null when every id is acceptable.
 */
export const validateLeafCategoryIds = async (categoryIds: number[]): Promise<string | null> => {
  const unique = [...new Set(categoryIds)];
  if (!unique.length) return "At least one parent category is required";

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
 * The pivot holds ONLY the categories an admin chose — no ancestor rows. Storing
 * ancestors here would conflate "filed under" with "reachable from", leaving no way
 * to read the admin's actual selection back out for the edit modal's chips. Parent
 * lookups expand the tree at read time instead (see descendantExamCategoryIds).
 *
 * Rows already present are left untouched (preserving created_at) so a re-save with
 * an unchanged set is a no-op.
 */
export const setExamCategories = async (
  examId: number,
  categoryIds: number[]
): Promise<void> => {
  const unique = [...new Set(categoryIds)];
  if (!unique.length) return; // guarded by validateLeafCategoryIds; never clear a set

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
