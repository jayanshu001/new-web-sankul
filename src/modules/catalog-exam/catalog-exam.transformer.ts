// Exam categories: row to DTO mapping (response shape is frozen).
import type { ExamCategory } from "@prisma/client";
import type { ExamCategoryDto } from "./catalog-exam.types";

/** Clients read the display name from both `title` and `name`, so both carry the column value. */
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
