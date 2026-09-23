import type { ExamCategory } from "@prisma/client";
import type { ExamCategoryDto } from "./catalog-exam.types";

/**
 * `ws_exam_category` row → DTO. The display field is `name`; the Mongo handler
 * surfaces BOTH `title` and `name` set to the column value, so we do the same.
 */
export const toExamCategoryDto = (row: ExamCategory): ExamCategoryDto => ({
  _id: String(row.id),
  title: row.name ?? null,
  name: row.name ?? null,
  image: row.image ?? null,
  parent: row.parent,
  order: row.order_by,
  status: row.status,
  createdAt: row.created_at ?? null,
  updatedAt: row.updated_at ?? null,
});
