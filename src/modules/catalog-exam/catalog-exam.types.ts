/**
 * Catalog · Exam (READ) — MySQL (Prisma) branch types.
 *
 * Tables: `ws_exam` (1 row) + `ws_exam_category` (121 rows; flag OFF). Scoped to
 * the **category-navigation** surface (`listExamCategoryChildren`) — the
 * genuinely-wirable part, mirroring catalog-material.
 *
 * ⚠ SCOPE — the exam ITEM listing/attempt surface is NOT built here
 * (`listExamsByCategory` + exam-taking touch question/option/result tables and
 * entitlement; out of scope this pass). Only the category tree is reproduced.
 *
 * DIFFERENCES vs catalog-material:
 *  - Display field is **`name`** (not `title`); the response sets BOTH `title`
 *    and `name` to the column value (the Mongo handler does `title: cat.name`).
 *  - `ws_exam_category` has a **`deleted`** flag (material category had none) →
 *    active = `status = true AND deleted = false`.
 *  - The per-child exam count is **UNCONDITIONAL** (`Exam.countDocuments({categoryId})`
 *    with no status filter) — matches the Mongo handler exactly.
 *  - `name`/`image` nullable in the DDL → relaxed in Prisma (no NULLs today).
 *
 * STRUCTURAL TRANSLATION: Mongo `childCategoryIds[]` embed → SQL `parent_id`
 * self-FK (children = `WHERE parent_id = id`). `havingChildDirectory` = ≥1 active
 * row with `parent_id = this.id`.
 *
 * Ids are returned as strings to stay Mongo `_id`-shape compatible.
 */

/** `ws_exam_category` row → DTO (Mongo `ExamCategory`-shaped; carries title+name). */
export interface ExamCategoryDto {
  _id: string;
  /** = name (the Mongo handler mirrors `title: cat.name`). */
  title: string | null;
  name: string | null;
  image: string | null;
  parent: number;
  order: number;
  status: boolean;
  createdAt: Date | null;
  updatedAt: Date | null;
}

/** A child category in the navigation list: category + count + has-children. */
export interface ExamCategoryChildDto extends ExamCategoryDto {
  /** UNCONDITIONAL count of exams in this category (matches Mongo). */
  count: number;
  havingChildDirectory: boolean;
}

/** The `listExamCategoryChildren` response payload. */
export interface ExamCategoryChildrenResult {
  parent: ExamCategoryDto;
  list: Array<{ category: ExamCategoryChildDto }>;
}
