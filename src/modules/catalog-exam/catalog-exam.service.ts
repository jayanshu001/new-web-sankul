/**
 * Catalog · Exam service — dual-path (MySQL/Prisma ↔ Mongo/Mongoose).
 *
 * Module key: `catalog-exam` (flag OFF). Scoped to category navigation:
 * `getCategoryChildren` reproduces `listExamCategoryChildren` (parent → active
 * children + per-child UNCONDITIONAL exam count + has-grandchildren).
 *
 * Children resolve via the SQL `parent_id` self-FK (the Mongo `childCategoryIds[]`
 * embed has no SQL column). Active = status=true AND deleted=false. See types.ts.
 */
import { isMysqlModule } from "../../config/migration";
import { catalogExamRepository as repo } from "./catalog-exam.repository";
import { toExamCategoryDto } from "./catalog-exam.transformer";
import type {
  ExamCategoryChildrenResult,
  ExamCategoryDto,
} from "./catalog-exam.types";

export const EXAM_MODULE = "catalog-exam";
export const isExamMysql = (): boolean => isMysqlModule(EXAM_MODULE);

/** Parse a string id to a positive int, else null. */
export const parseExamCategoryId = (id: string): number | null => {
  const n = Number(id);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** Single exam category by id (the navigation `parent`). */
export const findCategoryById = async (id: number): Promise<ExamCategoryDto | null> => {
  const row = await repo.findCategoryById(id);
  return row ? toExamCategoryDto(row) : null;
};

/**
 * The `listExamCategoryChildren` composition: parent + active children, each
 * with `count` (UNCONDITIONAL exam count) and `havingChildDirectory`. Returns
 * null if the parent is missing.
 */
export const getCategoryChildren = async (
  parentId: number,
  search?: string
): Promise<ExamCategoryChildrenResult | null> => {
  const parentRow = await repo.findCategoryById(parentId);
  if (!parentRow) return null;

  const children = await repo.listActiveChildren(parentId, {
    search: search?.trim() || undefined,
  });

  const childIds = children.map((c) => c.id);
  const [counts, parentsWithKids] = await Promise.all([
    Promise.all(childIds.map((cid) => repo.countExams(cid))),
    repo.parentsWithChildren(childIds),
  ]);
  const hasKids = new Set(parentsWithKids.map((r) => r.parent));

  const list = children.map((c, i) => ({
    category: {
      ...toExamCategoryDto(c),
      count: counts[i],
      havingChildDirectory: hasKids.has(c.id),
    },
  }));

  return { parent: toExamCategoryDto(parentRow), list };
};
