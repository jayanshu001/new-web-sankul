import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma";

/**
 * Category ids from a leaf up through ancestors (inclusive). `parent_id = 0` is root.
 */
export const categoryAncestorIds = (
  categoryId: number,
  catById: Map<number, { parent: number }>
): number[] => {
  const ids: number[] = [];
  const guard = new Set<number>();
  let cur: number | null = categoryId;
  while (cur != null && catById.has(cur) && !guard.has(cur)) {
    guard.add(cur);
    ids.push(cur);
    const parent: number = catById.get(cur)!.parent;
    cur = parent && parent !== 0 ? parent : null;
  }
  return ids;
};

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

/** AND-merge category match into an existing exam filter. */
export const withExamInCategories = (
  base: Prisma.ExamWhereInput,
  categoryIds: number[]
): Prisma.ExamWhereInput => ({
  AND: [base, examInCategoriesWhere(categoryIds)],
});

/**
 * Replace pivot rows for an exam: primary category + its ancestors (prod pattern).
 * Called after admin create/update so catalog parent links stay in sync.
 */
export const replaceExamCategoryPivot = async (
  examId: number,
  primaryCategoryId: number
): Promise<void> => {
  const categories = await prisma.examCategory.findMany({
    select: { id: true, parent: true },
  });
  const catById = new Map(categories.map((c) => [c.id, { parent: c.parent }]));
  if (!catById.has(primaryCategoryId)) return;

  const categoryIds = categoryAncestorIds(primaryCategoryId, catById);
  const now = new Date();

  await prisma.$transaction([
    prisma.examCategoryPivot.deleteMany({ where: { examId } }),
    prisma.examCategoryPivot.createMany({
      data: categoryIds.map((categoryId) => ({
        examId,
        categoryId,
        created_at: now,
        updated_at: now,
      })),
      skipDuplicates: true,
    }),
  ]);
};
